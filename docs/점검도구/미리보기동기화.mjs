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
 await evaluate(`(async()=>{window.testFolder=await (await navigator.storage.getDirectory()).getDirectoryHandle('features',{create:true});window.writeTest=async(name,txt)=>{let h=await testFolder.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(txt);await w.close();};await writeTest('outside.md','# First');await pkosLocal.attach(testFolder);})()`);
 check('initial folder scan',await evaluate(`pkosLocal.entries().some(n=>n.title==='First')`));
 await evaluate(`writeTest('outside.md','# Changed')`);await wait(3100);
 check('automatic external update',await evaluate(`pkosLocal.entries().some(n=>n.title==='Changed')`));
 await evaluate(`testFolder.removeEntry('outside.md')`);await wait(3100);
 check('external deletion marked without deleting record',await evaluate(`pkosLocal.entries().some(n=>n.title==='Changed'&&n.localMissing)`));
 await evaluate(`writeTest('outside.md','# Restored')`);await wait(3100);
 check('external reappearance',await evaluate(`pkosLocal.entries().some(n=>n.title==='Restored'&&!n.localMissing)`));
 await evaluate(`(async()=>{await writeTest('_visible.html','<h1>HTML TEST</h1>');for(let i=0;i<205;i++)await writeTest('bulk'+i+'.txt','test');await pkosLocal.importAll(null,{quiet:true});})()`);
 check('all 205 files imported',await evaluate(`pkosLocal.entries().filter(n=>/^bulk/.test(n.title)).length===205`));
 check('underscore HTML imported',await evaluate(`pkosLocal.entries().some(n=>n.title==='_visible')`));
 await evaluate(`(()=>{document.querySelector('.hm-quick input').value='URL test';document.querySelector('.hm-quick').requestSubmit();document.querySelector('#blocks').innerHTML='<p>https://example.com/</p>';document.querySelector('#blocks').dispatchEvent(new InputEvent('input',{bubbles:true}));document.querySelector('#btnSave').click();})()`);await wait(1000);
 check('save opens URL preview',await evaluate(`!!document.querySelector('.viewer iframe.record-preview')`));
 check('preview sandbox',await evaluate(`!document.querySelector('.viewer iframe').sandbox.contains('allow-same-origin')`));
 await evaluate(`document.querySelector('.viewer .vtop button').click()`);
 await evaluate(`(()=>{let d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'one.png',{type:'image/png'}));d.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'two.png',{type:'image/png'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);await wait(1800);
 check('photo batch saved as one record',await evaluate(`pkosLocal.entries().some(n=>n.blocks.length===2&&n.blocks.every(b=>b.kind==='image'))`));
 await evaluate(`(()=>{document.querySelector('#btnSettings').click();Array.from(document.querySelectorAll('.tabs .tab')).find(b=>b.textContent.includes('의견')).click();})()`);
 check('feedback only submission instructions',await evaluate(`document.querySelector('.mbody').textContent.includes('의견 작성하기')&&!/Apps Script|앱스 스크립트|주소 저장|보내지 않습니다/.test(document.querySelector('.mbody').textContent)`));
 await evaluate(`Array.from(document.querySelectorAll('.tabs .tab')).find(b=>b.textContent.includes('기록 유형')).click()`);
 check('only three types',await evaluate(`document.querySelector('.mbody').textContent==='기록 유형연수 · 아이디어 · 자료'`));

 await evaluate(`document.querySelector('.modal-bg').click()`);
 await evaluate(`document.querySelector('[data-page="library"].nav-item').click()`);
 const openRecord=async(title)=>{await evaluate(`(()=>{const old=document.querySelector('.viewer .vtop button');if(old)old.click();const q=document.querySelector('#search');q.value=${JSON.stringify(title)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(400);await evaluate(`(()=>{let c=document.querySelector('.card.entry');if(!c)throw Error('no card');c.querySelector('.dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('전체 보기')).click();})()`);await wait(500);};
 await openRecord('_visible');
 check('HTML actual srcdoc preview',await evaluate(`document.querySelector('.viewer iframe.record-preview').srcdoc.includes('HTML TEST')`));
 await openRecord('one 외');
 check('photo slides initial count',await evaluate(`document.querySelector('.viewer .media-slide-nav').textContent.includes('1 / 2')`));
 await evaluate(`document.querySelector('.viewer .media-slide-nav button:last-child').click()`);
 check('photo slides next',await evaluate(`document.querySelector('.viewer .media-slide-nav').textContent.includes('2 / 2')`));
 await evaluate(`document.querySelector('.viewer .vtop button').click()`);
 await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const stream=canvas.captureStream(5);const r=new MediaRecorder(stream);let chunks=[];r.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>r.onstop=resolve);r.start();await new Promise(resolve=>setTimeout(resolve,400));r.stop();await done;stream.getTracks().forEach(t=>t.stop());let d=new DataTransfer();d.items.add(new File(chunks,'videoone.webm',{type:'video/webm'}));d.items.add(new File(chunks,'videotwo.webm',{type:'video/webm'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);await wait(2200);
 await openRecord('videoone 외');
 check('video slides playable',await evaluate(`!!document.querySelector('.viewer video[controls]')&&document.querySelector('.viewer video').readyState>=1`));
 await evaluate(`document.querySelector('.viewer .media-slide-nav button:last-child').click()`);await wait(500);
 check('video slides next',await evaluate(`document.querySelector('.viewer .media-slide-nav').textContent.includes('2 / 2')&&document.querySelector('.viewer video').readyState>=1`));
 check('no runtime errors',errors.length===0,errors.join('\n'));
 if(results.some(r=>!r.ok))process.exitCode=1;
} finally {ws.close();edge.kill();}
