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


try{
 await send('Runtime.enable');await wait(1200);
 check('로컬 어댑터 준비',await evaluate('typeof pkosLocal.transfer === "function"'));
 await evaluate(`(async()=>{
  const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('transfer-test',{create:true});window.testRoot=dir;
  for(const name of ['source','target','third'])await dir.getDirectoryHandle(name,{create:true});
  window.readTest=async(path)=>{let d=testRoot;const ps=path.split('/');for(const p of ps.slice(0,-1))d=await d.getDirectoryHandle(p);return (await (await d.getFileHandle(ps.at(-1))).getFile());};
  window.writeTest=async(path,text)=>{let d=testRoot;const ps=path.split('/');for(const p of ps.slice(0,-1))d=await d.getDirectoryHandle(p,{create:true});const h=await d.getFileHandle(ps.at(-1),{create:true});const w=await h.createWritable();await w.write(text);await w.close();};
  await writeTest('source/record.md','---\\nid: transfer-original\\ntitle: 이동 복사 시험\\ntype: 자료\\ncreated: 2026-09-12\\n---\\n\\n보존할 본문\\n\\n![첨부](data.png)\\n');
  await writeTest('source/data.png',new Uint8Array([0,255,12,128,6]));
  await pkosLocal.attach(dir);
 })()`);
 check('원본 기록 가져오기',await evaluate('pkosLocal.entries().some(n=>n.id==="transfer-original")'));
 const copy=await evaluate(`pkosLocal.transfer({entryId:'transfer-original'},['target'],'copy')`);
 check('복사 새 기록 ID',copy.entryId!=='transfer-original');
 check('원본 파일과 본문 보존',await evaluate(`(async()=> (await (await readTest('source/record.md')).text()).includes('보존할 본문') && (await readTest('source/data.png')).size===5)()`));
 check('첨부 복사 바이트 동일',await evaluate(`(async()=>JSON.stringify(Array.from(new Uint8Array(await (await readTest('target/data.png')).arrayBuffer())))==='[0,255,12,128,6]')()`));
 const moved=await evaluate(`pkosLocal.transfer({entryId:${JSON.stringify(copy.entryId)}},['third'],'move')`);
 check('이동 파일 경로 반영',moved.paths.some(p=>p.startsWith('local:third/')));
 check('이전 사본 삭제와 원본 유지',await evaluate(`(async()=>{try{await readTest('target/record.md');return false;}catch{}return (await readTest('source/record.md')).size>0&&(await readTest('third/record.md')).size>0;})()`));
 check('같은 폴더 이동 차단',await evaluate(`pkosLocal.transfer({entryId:'transfer-original'},['source'],'move').then(()=>false,()=>true)`));
 await evaluate(`pkosLocal.folderTree()`);await wait(500);
 check('폴더 구조 실제 파일과 대상 표시',await evaluate(`document.querySelectorAll('[data-transfer-file]').length>=4 && document.querySelector('.treebox [data-drop-path]')!==null`));
 await evaluate(`(()=>{const row=document.querySelector('[data-transfer-file="local:source/data.png"]');const to=[...document.querySelectorAll('.treebox [data-drop-path]')].find(n=>n.dataset.dropPath==='["target"]');const dt=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
 check('드래그 후 선택창',await evaluate(`!!document.querySelector('[data-transfer-action="copy"]')&&!!document.querySelector('[data-transfer-action="move"]')`));
 await evaluate(`document.querySelector('[data-transfer-action="copy"]').click()`);await wait(1800);
 check('드래그 복사 실제 저장',await evaluate(`(async()=> (await readTest('target/data.png')).size===5 && (await readTest('source/data.png')).size===5)()`));
 await send('Page.reload');await wait(1200);await evaluate(`(async()=>{const r=await navigator.storage.getDirectory();await pkosLocal.attach(await r.getDirectoryHandle('transfer-test'));})()`);
 check('재연결 후 이동 경로 유지',await evaluate(`pkosLocal.entries().some(n=>n.id===${JSON.stringify(copy.entryId)}&&n.localDir==='third')`));
 await evaluate(`document.querySelector('[data-go="graph"]').click()`);await wait(900);
 check('지식맵 폴더 드롭 대상',await evaluate(`document.querySelectorAll('.graph-folder-tray [data-drop-path]').length>=4`));

 await evaluate(`(()=>{const arc=CanvasRenderingContext2D.prototype.arc,clear=CanvasRenderingContext2D.prototype.clearRect;window.testArcs=[];CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.id==='graphCanvas')window.testArcs=[];return clear.apply(this,a);};CanvasRenderingContext2D.prototype.arc=function(x,y,r,...a){if(this.canvas.id==='graphCanvas'&&r>=6&&r<=16){const pt=this.getTransform().transformPoint({x,y});const rect=this.canvas.getBoundingClientRect();window.testArcs.push({x:rect.left+pt.x*this.canvas.clientWidth/this.canvas.width,y:rect.top+pt.y*this.canvas.clientHeight/this.canvas.height});}return arc.call(this,x,y,r,...a);};})()`);await wait(500);
 const coords=await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-folder-tray [data-drop-path]')].find(b=>b.dataset.dropPath==='["target"]');const r=b.getBoundingClientRect();return {node:window.testArcs[0],target:{x:r.x+r.width/2,y:r.y+r.height/2}};})()`);
 if(!coords.node)throw Error('graph node not found');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.node.x,y:coords.node.y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:coords.node.x,y:coords.node.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.target.x,y:coords.target.y,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:coords.target.x,y:coords.target.y,button:'left',clickCount:1});
 check('지식맵 점을 폴더로 실제 드래그',await evaluate(`!!document.querySelector('[data-transfer-action="copy"]')`));
 if(await evaluate(`!!document.querySelector('[data-transfer-action="cancel"]')`))await evaluate(`document.querySelector('[data-transfer-action="cancel"]').click()`);
 const collision=await evaluate(`pkosLocal.transfer({entryId:'transfer-original'},['source'],'copy')`);
 check('같은 이름 덮어쓰기 방지',collision.paths.some(p=>p.includes('(2)')||p.includes('_2')||p.includes('-2')),JSON.stringify(collision.paths));
 const screen=await send('Page.captureScreenshot',{format:'png'});(await import('node:fs')).writeFileSync('local-service/runtime/transfer-graph.png',Buffer.from(screen.data,'base64'));
 check('화면 오류 없음',errors.length===0,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
