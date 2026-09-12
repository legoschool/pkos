/* PKOS 화면 점검 · Edge 를 머리 없이 띄워 CDP 로 직접 눌러 본다.
   설치할 것 없음: 노드 24 에 들어 있는 WebSocket 만 쓴다.
   실행:  node smoke.mjs [url] */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const URL_ = process.argv[2] || "http://localhost:8000/";
/* ⚠️ 자리(포트)를 9333 으로 못 박아 두었다. 점검이 도중에 죽으면 브라우저가
   그 자리를 문 채로 남고, 다음 점검은 «자기 브라우저를 못 띄운 채» 남의 빈 탭에
   붙는다. 그러고는 「＋버튼 0개 · 색감 null」 이라고 말한다 · 앱은 멀쩡한데.
   한나절을 여기서 잃었다. 자리는 «비어 있는 것을 그때그때» 받아 쓴다. */
const PORT = await new Promise((res, rej) => {
  const srv = createServer();
  srv.on("error", rej);
  srv.listen(0, "127.0.0.1", () => {
    const got = srv.address().port;
    srv.close(() => res(got));
  });
});

// 엣지든 크롬이든 있는 것을 쓴다
import { existsSync } from "node:fs";
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "pkos-smoke-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  // 마이크가 없는 기계에서도 녹음을 시험할 수 있게 «가짜 마이크» 를 붙인다
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  URL_,
], { stdio: "ignore" });
/* ⚠️ 끝에서만 edge.kill() 을 부르면, 도중에 넘어졌을 때 브라우저가 살아 남는다.
   나가는 «모든» 길에서 끄도록 여기서 한 번에 걸어 둔다. */
process.on("exit", () => { try { edge.kill(); } catch {} });
["SIGINT", "SIGTERM"].forEach((sig) =>
  process.on(sig, () => { try { edge.kill(); } catch {} process.exit(130); }));

let ws, msgId = 0;
const pending = new Map();
const errors = [];
const logs = [];

/* 답이 안 오면 영원히 매달린다. 그러면 「멈춘 채로 끝」이라 무엇이 잘못됐는지 모른다.
   30초 안에 답이 없으면 그 자리에서 실패로 알린다. */
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`${method} 이 30초 안에 답하지 않았습니다`));
    }, 30000);
    pending.set(id, {
      res: v => { clearTimeout(t); res(v); },
      rej: e => { clearTimeout(t); rej(e); },
    });
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
}

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

/* 넣기 줄 밖에 있든 «⋯ 더» 안에 있든, 그 갈래를 넣을 수 있으면 된다 */
const addByKind = (kind, korean) => `(() => {
  const direct = document.querySelector('[data-add="${kind}"]');
  if (direct) { direct.click(); return true; }
  const more = document.getElementById('btnAddMore');
  if (!more) return false;
  more.click();
  const it = Array.from(document.querySelectorAll('.menupop button')).find(b => b.textContent.indexOf('${korean}') >= 0);
  if (it) it.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return !!it;
})()`;
/* 3단(≥1180px)과 2단은 «다른 화면» 이다 · 접기·여는 법이 갈린다.
   그래서 점검도 어느 쪽을 보는지 정하고 들어간다. */
const twoPane = () => send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
const anyPane = () => send("Emulation.clearDeviceMetricsOverride");
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " · " + detail : ""}`);
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await send("DOM.enable");
await wait(2500);


try {
 const fixtures=JSON.parse((await import('node:fs')).readFileSync(new URL('./문서이미지-fixtures.json',import.meta.url),'utf8'));
 await evaluate(`window.imageFixtures=${JSON.stringify(fixtures)};window.imageFile=n=>new File([Uint8Array.from(atob(imageFixtures[n]),c=>c.charCodeAt(0))],n);`);
 check('DOCX referenced images in order and duplicates removed',await evaluate(`PKOSDocuments.read(imageFile('images.docx'),'images.docx').then(r=>r.sections[0].images.map(i=>i.name).join(',')==='red.png,blue.png')`));
 check('PPTX images follow slide order',await evaluate(`PKOSDocuments.read(imageFile('images.pptx'),'images.pptx').then(r=>r.sections[0].lines[0]==='앞장'&&r.sections[0].images[0].name==='blue.png'&&r.sections[1].images[0].name==='red.png')`));
 check('Unsupported and external images preserve text and valid images',await evaluate(`PKOSDocuments.read(imageFile('mixed.docx'),'mixed.docx').then(r=>r.sections[0].images.length===2&&r.sections[0].lines[0].includes('문서 검색어')&&r.note.includes('생략'))`));
 check('Full text search skips images',await evaluate(`PKOSDocuments.read(imageFile('images.docx'),'images.docx',{fullText:true}).then(r=>!r.sections[0].images&&r.sections[0].lines[0].includes('검색어'))`));
 await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();await pkosLocal.attach(root);const dt=new DataTransfer();dt.items.add(imageFile('images.docx'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);await wait(350);
 await evaluate(`document.querySelector('[data-incoming-save]').click()`);await wait(1800);
 check('Saved document bytes match original',await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();const folder=await root.getDirectoryHandle('받은 파일');const f=await(await folder.getFileHandle('images.docx')).getFile();return btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())))===imageFixtures['images.docx'];})()`));
 await evaluate(`(()=>{document.querySelector('[data-page="library"].nav-item').click();const c=document.querySelector('.card.entry');c.querySelector('.dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('전체 보기')).click();})()`);await wait(700);
 check('First image rendered in document viewer',await evaluate(`(()=>{const img=document.querySelector('.viewer .document-images img');return img?.naturalWidth===80&&img.alt.includes('red.png');})()`));
 await evaluate(`document.querySelector('.viewer .document-image-controls button:last-child').click()`);await wait(250);
 check('Next image rendered with position and boundary',await evaluate(`(()=>{const g=document.querySelector('.viewer .document-images');return g.querySelector('img').naturalWidth===80&&g.querySelector('img').alt.includes('blue.png')&&g.querySelector('span').textContent==='2 / 2'&&g.querySelector('button:last-child').disabled;})()`));
 await evaluate(`document.querySelector('.viewer .document-image-controls button:first-child').click()`);await wait(200);
 check('Previous image rendered',await evaluate(`document.querySelector('.viewer .document-images img').alt.includes('red.png')`));
 await evaluate(`Array.from(document.querySelectorAll('.viewer .vtop button')).find(b=>b.textContent.includes('편집')).click()`);await wait(700);
 check('Images render inside editor',await evaluate(`Array.from(document.querySelectorAll('.document-images img')).some(img=>img.naturalWidth===80&&img.closest('figure.atom'))`));
 await evaluate(`document.querySelector('figure.atom .document-images').scrollIntoView({block:'center'})`);await wait(150);
 const shot=await send('Page.captureScreenshot',{format:'png'});
 (await import('node:fs')).writeFileSync(new URL('../../local-service/runtime/document-images.png',import.meta.url),Buffer.from(shot.data,'base64'));
 await send('Page.reload');await wait(2200);
 check('Reload retains document search text',await evaluate(`pkosLocal.entries().some(n=>n.blocks.some(b=>(b.searchText||'').includes('문서 검색어')))`));
 check('No runtime errors',!errors.length,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
