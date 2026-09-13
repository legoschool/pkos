import { readFileSync } from 'node:fs';
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
 for(let i=0;i<60;i++){if(await evaluate('window.pkosLocal?.isOn()'))break;await wait(200);}
 await evaluate(`document.querySelector('[data-page="library"].nav-item').click()`);await wait(300);
 check('records start collapsed',await evaluate(`Array.from(document.querySelectorAll('.card.entry')).every(c=>!c.querySelector('.content'))`));
 await evaluate(`document.querySelector('[data-eid="photo-test"] .titlebtn').click()`);await wait(200);
 check('title expands inline preview',await evaluate(`!!document.querySelector('[data-eid="photo-test"] .content img')`));
 await evaluate(`document.querySelector('[data-eid="photo-test"] .titlebtn').click()`);
 check('title collapses',await evaluate(`!document.querySelector('[data-eid="photo-test"] .content')`));
 await evaluate(`(()=>{document.querySelector('[data-eid="photo-test"] .dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('편집')).click();})()`);await wait(300);
 check('simplified toolbar',await evaluate(`!document.querySelector('.edbar [data-add="todo"],.edbar [data-add="list"],.edbar [data-add="source"],.edbar [data-add="code"]')`));
 await evaluate(`document.querySelector('#btnPhotoViews').click();Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='바둑판 보기').click()`);await wait(200);
 check('multiple photos grid view',await evaluate(`document.querySelectorAll('.photo-grid img').length===2`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='슬라이드 보기').click()`);
 check('multiple photos slide view',await evaluate(`document.querySelectorAll('.media-slide-stage img').length===1&&!document.querySelector('.media-slide-nav').hidden`));
 await evaluate(`document.querySelector('.media-slide-stage img').click()`);await wait(200);
 check('gallery photo opens editing studio',await evaluate(`!!document.querySelector('.maskcanvas')||!!document.querySelector('.modal canvas')`));
 await evaluate(`document.querySelector('.modal .mhead button').click()`);

 await evaluate(`document.querySelector('#blocks .pimg').click()`);
 for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('.maskpad')?.width===64`))break;await wait(100);}
 check('local photo loads in studio',await evaluate(`document.querySelector('.maskpad')?.width===64&&document.querySelector('.maskpad').height===48`));
 await evaluate(`(()=>{const cv=document.querySelector('.maskpad');window.beforePixels=cv.toDataURL();const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,pointerId:1,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));})()`);
 check('mosaic changes pixels',await evaluate(`document.querySelector('.maskpad').toDataURL()!==beforePixels`));
 await evaluate(`(()=>{Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='펜').click();const cv=document.querySelector('.maskpad');window.beforePen=cv.toDataURL();const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*.2,clientY:r.top+r.height*.2,pointerId:2,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,bubbles:true}));})()`);
 check('pen changes pixels',await evaluate(`document.querySelector('.maskpad').toDataURL()!==beforePen`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent.includes('다 됐습니다')).click()`);await wait(250);
 check('photo returns to editor',await evaluate(`!document.querySelector('.maskpad')&&!!document.querySelector('#blocks .pimg')`));
 // File input exercises new-photo naming without writing any personal file.
 await evaluate(`document.getElementById('title').value='Photo title'`);
 await send('DOM.enable');let root=await send('DOM.getDocument');let inp=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#imgInput'});
 await send('DOM.setFileInputFiles',{nodeId:inp.nodeId,files:[process.argv[3]]});await wait(200);
 await evaluate(`document.querySelector('[data-incoming-save]')?.click()`);await wait(700);
 check('photo filename uses current title',await evaluate(`document.getElementById('blocks').textContent.includes('Photo title.png')`));
 // Audio import commits just one attachment, retaining unsaved text and record count.
 await evaluate(`window.recordCount=pkosLocal.entries().length;document.querySelector('[data-add="voice"]').click()`);await wait(200);
 root=await send('DOM.getDocument');inp=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'.modal input[type="file"]'});
 await send('DOM.setFileInputFiles',{nodeId:inp.nodeId,files:[process.argv[4]]});await wait(300);
 check('audio duration is finite',await evaluate(`(()=>{const a=document.querySelector('.modal audio');return Number.isFinite(a.duration)&&Math.abs(a.duration-1)<.1;})()`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='녹음 파일 첨부').click()`);await wait(300);
 check('audio does not save whole draft or add transcript',await evaluate(`pkosLocal.entries().length===recordCount&&!document.getElementById('blocks').textContent.includes('전사 확인')&&document.getElementById('btnSave').textContent==='수정 저장'`));
 // Markdown typed into ordinary text converts on explicit save.
 await evaluate(`(()=>{const p=document.getElementById('blocks');p.appendChild(document.createElement('div')).textContent='## Markdown heading';p.appendChild(document.createElement('div')).textContent='- Markdown item';document.getElementById('btnSave').click();})()`);await wait(800);
 check('Markdown saved as heading/list',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.id==='photo-test');return n.blocks.some(b=>b.kind==='heading'&&b.text.includes('Markdown heading'))&&n.blocks.some(b=>b.kind==='list');})()`));
 // Responsive viewport bounds and no new script exceptions.
 for(const width of [390,768,1024,1280,1920]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await wait(120);check('viewport '+width,await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));}
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await wait(350);
 await evaluate(`(()=>{const ns=pkosLocal.entries();ns.push({...ns[0],id:'trash-fixture',trashed:true,localMissing:false,mdId:null,srcId:null,blocks:[]});document.getElementById('typeFilters').querySelector('button').click();const b=Array.from(document.querySelectorAll('.smartrow')).find(b=>b.textContent.includes('휴지통'));b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:100}));})()`);
 check('trash bulk context actions',await evaluate(`document.querySelector('.menupop').textContent.includes('전체 복원')&&document.querySelector('.menupop').textContent.includes('전체 삭제')`));
 await evaluate(`Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('전체 복원')).click()`);await wait(200);
 check('trash bulk restore',await evaluate(`!pkosLocal.entries().find(n=>n.id==='trash-fixture').trashed`));

 const code=readFileSync('index.html','utf8');const wavCode=code.slice(code.indexOf('  async function recordingWav('),code.indexOf('  function fixAudioDuration('));
 check('recorded WebM converted with correct duration',await evaluate(`(async()=>{${wavCode}
 const ctx=new AudioContext(),osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination();osc.connect(out);osc.start();await ctx.resume();const rec=new MediaRecorder(out.stream),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);const done=new Promise(r=>rec.onstop=r);rec.start();await new Promise(r=>setTimeout(r,1100));rec.stop();await done;osc.stop();await ctx.close();const wav=await recordingWav(new Blob(chunks,{type:rec.mimeType}));const bytes=await wav.arrayBuffer();const v=new DataView(bytes);const seconds=v.getUint32(40,true)/v.getUint32(28,true);return wav.type==='audio/wav'&&seconds>.8&&seconds<1.6;
 })()`));
 check('no exceptions',errors.length===0,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
