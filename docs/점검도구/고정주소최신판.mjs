/* 고정 주소 점검 · 새 판을 올린 뒤에도 «같은 주소» 가 곧바로 새 판을 여는지 본다.
   GitHub Pages 처럼 Cache-Control: max-age=600 과 ETag 를 붙이는 작은 서버를 세우고,
   index.html 과 version.json 을 바꿔 «배포» 를 흉내 낸다. 설치할 것 없음 (노드 24 · Edge).
   실행:  node docs/점검도구/고정주소최신판.mjs   (저장소 뿌리에서) */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const ROOT = resolve(".");
if (!existsSync(join(ROOT, "sw.js"))) { console.error("저장소 뿌리에서 실행해 주세요."); process.exit(2); }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".wasm": "application/wasm" };

/* 몇 번째 판을 올려 두었나. 바꾸면 index.html 의 표식과 version.json 이 함께 바뀐다 */
let release = 1;
let URL_ = "";
function served(name) {
  if (name === "version.json") {
    return Buffer.from(JSON.stringify({ app: "PKOS", commit: "release-" + release, short: "r" + release,
      time: "2026-09-15T10:0" + release + ":00+09:00", message: "release " + release, url: URL_ }));
  }
  const file = resolve(ROOT, name);
  if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  const bytes = readFileSync(file);
  if (name !== "index.html") return bytes;
  return Buffer.from(bytes.toString("utf8").replace("</head>", `<meta name="pkos-test-release" content="${release}"></head>`));
}
const server = createHttpServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://local/").pathname.slice(1)) || "index.html";
  const bytes = served(name);
  if (!bytes) { res.writeHead(404); res.end(); return; }
  const tag = '"' + (name === "index.html" || name === "version.json" ? "r" + release + "-" : "") + bytes.length + '"';
  const head = { "Content-Type": TYPES[extname(name)] || "application/octet-stream", "Cache-Control": "max-age=600", "ETag": tag };
  if (req.headers["if-none-match"] === tag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(bytes);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
URL_ = "http://127.0.0.1:" + server.address().port + "/";

const PORT = await new Promise((res, rej) => {
  const srv = createServer();
  srv.on("error", rej);
  srv.listen(0, "127.0.0.1", () => { const got = srv.address().port; srv.close(() => res(got)); });
});
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "pkos-address-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });
process.on("exit", () => { try { edge.kill(); } catch {} });
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => { try { edge.kill(); } catch {} process.exit(130); }));

let ws, msgId = 0;
const pending = new Map();
const errors = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 이 30초 안에 답하지 않았습니다`)); }, 30000);
    pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
}
/* 쪽을 옮기는 도중에는 evaluate 가 넘어진다 · 될 때까지 다시 묻는다 */
async function waitFor(expression, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return true; } catch {}
    await wait(200);
  }
  return false;
}
async function open(url) {
  await send("Page.navigate", { url: "about:blank" });
  await waitFor(`location.href === 'about:blank'`, 5000);
  await send("Page.navigate", { url });
  return waitFor(`location.href !== 'about:blank' && !!document.getElementById('composer') && document.readyState === 'complete'`);
}
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " · " + detail : ""}`);
}
const releaseOnPage = `document.querySelector('meta[name="pkos-test-release"]')?.content || ''`;

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 아직 안 떴다 */ }
    await wait(250);
  }
  throw new Error("Edge 디버깅 포트에 붙지 못했습니다");
}
ws = new WebSocket(await connect());
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

try {
  check("앱이 열린다", await open(URL_ + "?deploy=abc1234"));
  await wait(800);
  check("옛 ?deploy= 꼬리를 주소창에서 지운다", await evaluate(`!/[?&]deploy=/.test(location.search)`), await evaluate(`location.href`));
  await evaluate(`navigator.serviceWorker.ready.then(() => true)`);
  /* clients.claim() 때문에 새로 읽기 «전» 쪽도 이미 서비스 워커가 맡고 있다 · 표시를 남겨 옛 쪽과 가른다 */
  await evaluate(`window.__beforeReload = true`);
  await send("Page.reload");
  check("서비스 워커가 화면을 맡는다", await waitFor(`!window.__beforeReload && document.readyState === 'complete' && !!navigator.serviceWorker.controller && !!document.getElementById('composer')`));
  const first = await evaluate(releaseOnPage);
  check("처음 연 판", first === "1", "열린 판 " + first);

  release = 2;   // 새 판을 올렸다 · 브라우저 캐시에는 1판이 아직 10분짜리로 살아 있다
  await open(URL_);
  const second = await evaluate(releaseOnPage);
  check("새 판을 올린 뒤 같은 주소가 곧바로 새 판을 연다", second === "2", "열린 판 " + second);

  const known = await waitFor(`!!(window.pkosDeploy && pkosDeploy.info().opened)`, 8000);
  check("배포 판 정보를 읽는다", known && (await evaluate(`pkosDeploy.info().opened.short`)) === "r2");
  await evaluate(`document.getElementById('btnSettings').click()`);
  await wait(300);
  await evaluate(`Array.from(document.querySelectorAll('.modal .tabs .tab')).find((b) => b.textContent.trim() === '고급').click()`);
  await wait(300);
  const advanced = await evaluate(`document.querySelector('.modal .mbody').textContent`);
  check("설정 → 고급에 고정 주소와 지금 연 판이 보인다", advanced.includes(URL_) && advanced.includes("r2"), advanced.slice(0, 120));
  await evaluate(`document.querySelector('.modal .mhead button').click()`);

  release = 3;   // 앱을 펴 둔 동안 또 올렸다
  await evaluate(`window.pkosDeploy && pkosDeploy.check(true)`);
  const barShown = await waitFor(`(() => { const b = document.getElementById('updateBar'); return !!b && !b.classList.contains('hidden') && b.textContent.includes('새 판') && b.getBoundingClientRect().height > 0; })()`, 5000);
  check("펴 둔 동안 새 판이 올라오면 알린다", barShown);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(300);
  check("알림이 폰 너비를 넘지 않는다", await evaluate(`(() => { const r = document.getElementById('updateBar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate(`window.__beforeReload = true; document.querySelector('#updateBar button').click()`);
  check("새로고침 한 번이면 같은 주소에서 새 판", await waitFor(`!window.__beforeReload && document.readyState === 'complete' && ${releaseOnPage} === '3' && !!document.getElementById('composer')`));
  await wait(1200);
  check("새로고침 뒤에는 알림이 사라진다", await evaluate(`document.getElementById('updateBar').classList.contains('hidden')`));

  server.closeAllConnections();
  await new Promise((r) => server.close(r));   // 서버가 멈췄다 (인터넷이 끊긴 것과 같다)
  await open(URL_);
  check("서버가 멈춰도 마지막으로 받은 판을 연다", (await evaluate(releaseOnPage)) === "3");
  check("실행 오류 없음", errors.length === 0, errors.join("\n"));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} finally {
  ws.close();
  edge.kill();
  server.closeAllConnections();
  server.close();
}
