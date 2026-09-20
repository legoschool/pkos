import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const target = process.argv[2] || "http://127.0.0.1:8791/?localBridge=1";
const browserPath = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!browserPath) throw new Error("Edge 또는 Chrome을 찾지 못했습니다.");

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const profile = mkdtempSync(join(tmpdir(), "pkos-new-ui-"));
const browser = spawn(browserPath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", target,
], { stdio: "ignore" });

function stopBrowser() {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
      const marker = `--remote-debugging-port=${port}`;
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$m='${marker}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like ('*'+$m+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
    } else browser.kill();
  } catch {}
}
process.on("exit", stopBrowser);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function debuggerUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = pages.find(row => row.type === "page" && row.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error("시험 브라우저에 연결하지 못했습니다.");
}

const socket = new WebSocket(await debuggerUrl());
let messageId = 0;
const pending = new Map();
const consoleErrors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map(item => item.value ?? item.description).join(" "));
  }
};
await new Promise(resolve => { socket.onopen = resolve; });

function send(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 응답 시간 초과`)); }, 20000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "화면 평가 실패");
  return result.result.value;
}
function check(label, condition, detail = "") {
  console.log(`${condition ? "  OK  " : " FAIL "} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

const failures = [];
try {
  await send("Runtime.enable");
  await send("Page.enable");
  await wait(1800);

  const base = await evaluate(`({
    edition: document.documentElement.dataset.pkosEdition,
    navToken: getComputedStyle(document.documentElement).getPropertyValue('--pkos-nav').trim(),
    skip: !!document.querySelector('.pkos-skip'),
    search: document.querySelector('#search')?.getAttribute('aria-label') || '',
    connection: !!document.querySelector('#pkosConnection'),
    oldMetaphor: /별자리|나의 별/.test(document.body.innerText)
  })`);
  check("PKOS NEW 보강 코드가 실행된다", base.edition === "new", base.edition);
  check("탐색 폭 토큰이 적용된다", base.navToken === "220px", base.navToken);
  check("본문 건너뛰기 링크가 있다", base.skip);
  check("검색 단축키를 읽어 준다", base.search.includes("Ctrl K"), base.search);
  check("저장 위치 상태가 있다", base.connection);
  check("별자리 비유가 없다", !base.oldMetaphor);

  for (const width of [1440, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 390 });
    await wait(150);
    const view = await evaluate(`({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      navWidth: Math.round(document.querySelector('#appNav').getBoundingClientRect().width),
      headerLeft: Math.round(document.querySelector('header.top').getBoundingClientRect().left),
      connectionDisplay: getComputedStyle(document.querySelector('#pkosConnection')).display,
      paperSize: parseFloat(getComputedStyle(document.querySelector('#blocks')).fontSize)
    })`);
    check(`${width}px에서 가로 넘침이 없다`, !view.overflow, JSON.stringify(view));
    if (width === 1440) {
      check("PC 탐색 패널은 220px다", view.navWidth === 220, String(view.navWidth));
      check("PC 상단 바는 탐색 옆에서 시작한다", view.headerLeft === 220, String(view.headerLeft));
    }
    if (width === 390) {
      check("휴대폰에서 상단 바가 화면 왼쪽부터 시작한다", view.headerLeft === 0, String(view.headerLeft));
      check("휴대폰에서 중복 저장 상태를 숨긴다", view.connectionDisplay === "none", view.connectionDisplay);
      check("휴대폰 본문 글자가 16px 이상이다", view.paperSize >= 16, String(view.paperSize));
    }
  }
  check("자바스크립트 오류가 없다", consoleErrors.length === 0, consoleErrors.join(" | "));
  if (failures.length) throw new Error(`PKOS NEW 화면 검사 실패 ${failures.length}개`);
  console.log("PASS PKOS NEW UI 16/16");
} finally {
  try { socket.close(); } catch {}
  stopBrowser();
}
