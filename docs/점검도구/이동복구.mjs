/* 이동·복사 도중 끊겨도 폴더가 어긋나지 않는지 · 복구 기록(PKOS-transfer.json)으로 사본을 걷고 문서를 되돌리고 남은 원본을 마저 지우는지 본다 (2026-09-17).
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

 /* ---- 여기부터 이 점검의 몸통 ----
    옮기다 끊긴 자리를 흉내 낸다: 복구 기록(PKOS-transfer.json)과 «끊긴 채» 의 파일들을 직접 만들어 두고 다시 연결한다.
    브라우저 안 폴더(OPFS)만 쓴다. 사용자 폴더는 손대지 않는다. */
 const PNG = [0, 255, 12, 128, 6], PNG_B = [9, 8, 7];
 await evaluate(`(async()=>{
  const root=await navigator.storage.getDirectory();
  try{await root.removeEntry('recover-test',{recursive:true});}catch{}
  const dir=await root.getDirectoryHandle('recover-test',{create:true});window.testRoot=dir;
  for(const name of ['source','target'])await dir.getDirectoryHandle(name,{create:true});
  window.readTest=async(path)=>{let d=testRoot;const ps=path.split('/');for(const p of ps.slice(0,-1))d=await d.getDirectoryHandle(p);return (await (await d.getFileHandle(ps.at(-1))).getFile());};
  window.existsTest=async(path)=>{try{await readTest(path);return true;}catch{return false;}};
  window.writeTest=async(path,data)=>{let d=testRoot;const ps=path.split('/');for(const p of ps.slice(0,-1))d=await d.getDirectoryHandle(p,{create:true});const h=await d.getFileHandle(ps.at(-1),{create:true});const w=await h.createWritable();await w.write(data);await w.close();};
  window.fp=async(path)=>pkosLocal.fingerprint(await readTest(path));
  await writeTest('source/record.md','---\\nid: recover-original\\ntitle: 복구 시험\\ntype: 자료\\ncreated: 2026-09-17\\n---\\n\\n본문\\n\\n![첨부](data.png)\\n');
  await writeTest('source/data.png',new Uint8Array(${JSON.stringify(PNG)}));
  await writeTest('source/other.md','---\\nid: recover-other\\ntitle: 같이 쓰는 기록\\ntype: 자료\\ncreated: 2026-09-17\\n---\\n\\n![공유](data.png)\\n');
  await pkosLocal.attach(dir);
 })()`);
 check('기록 두 편 가져오기', await evaluate(`pkosLocal.entries().filter(n=>['recover-original','recover-other'].includes(n.id)).length===2`));

 // 1. 정상 옮기기 뒤에는 복구 기록이 남지 않고, 그 파일이 기록으로 세어지지도 않는다
 const moved = await evaluate(`pkosLocal.transfer({fileId:'local:source/data.png'},['target'],'move')`);
 check('첨부 이동 성공', moved.paths[0] === 'local:target/data.png');
 check('정상 이동 뒤 복구 기록 없음', await evaluate(`existsTest('PKOS-transfer.json').then(v=>!v)`));
 check('복구 기록 이름은 기록으로 세지 않는다', await evaluate(`!pkosLocal.entries().some(n=>(n.mdName||'')==='PKOS-transfer.json'||(n.blocks||[]).some(b=>(b.name||'')==='PKOS-transfer.json'))`));

 // 2. copy 단계에서 끊김 · 사본은 생겼고 문서는 고쳐 썼는데 목록은 옛것 → 사본 지우고 문서 되돌리기
 const before = '---\nid: recover-other\ntitle: 같이 쓰는 기록\ntype: 자료\ncreated: 2026-09-17\n---\n\n![공유](../target/data.png)\n';
 const after = before.replace('../target/data.png', '../third/data.png');
 await evaluate(`(async()=>{
  await writeTest('third/data.png',new Uint8Array(${JSON.stringify(PNG)}));          // 끊기기 전에 만든 사본
  await writeTest('source/other.md',${JSON.stringify(after)});                          // 이미 고쳐 쓴 문서
  const hash=await fp('target/data.png');
  const journal={v:1,mode:'move',startedAt:Date.now(),phase:'copy',
    sources:[{id:'local:target/data.png',hash}],
    created:[{id:'local:third/data.png',hash}],
    docs:[{id:'local:source/other.md',before:${JSON.stringify(before)},beforeHash:await pkosLocal.fingerprint(new Blob([${JSON.stringify(before)}])),afterHash:await pkosLocal.fingerprint(new Blob([${JSON.stringify(after)}]))}]};
  await writeTest('PKOS-transfer.json',JSON.stringify(journal));
  await pkosLocal.attach(testRoot);
 })()`);
 check('copy 단계 복구: 끊긴 사본을 지운다', await evaluate(`existsTest('third/data.png').then(v=>!v)`));
 check('copy 단계 복구: 원본은 그대로', await evaluate(`readTest('target/data.png').then(f=>f.size===5)`));
 check('copy 단계 복구: 고쳐 쓴 문서를 원문으로 되돌린다', await evaluate(`readTest('source/other.md').then(f=>f.text()).then(t=>t===${JSON.stringify(before)})`));
 check('copy 단계 복구: 복구 기록을 지운다', await evaluate(`existsTest('PKOS-transfer.json').then(v=>!v)`));

 // 3. indexed 단계에서 끊김 · 목록은 새것, 원본이 남음 → 아무도 안 쓰는 원본만 지운다
 await evaluate(`(async()=>{
  await writeTest('source/leftover.png',new Uint8Array(${JSON.stringify(PNG_B)}));     // 옮기고 지우지 못한 원본 (목록에 없음)
  const journal={v:1,mode:'move',startedAt:Date.now(),phase:'indexed',
    sources:[{id:'local:source/leftover.png',hash:await fp('source/leftover.png')},{id:'local:target/data.png',hash:await fp('target/data.png')}],created:[],docs:[]};
  await writeTest('PKOS-transfer.json',JSON.stringify(journal));
  await pkosLocal.attach(testRoot);
 })()`);
 check('indexed 단계 복구: 남은 원본을 지운다', await evaluate(`existsTest('source/leftover.png').then(v=>!v)`));
 check('indexed 단계 복구: 기록이 쓰는 파일은 지우지 않는다', await evaluate(`readTest('target/data.png').then(f=>f.size===5)`));
 check('indexed 단계 복구: 복구 기록을 지운다', await evaluate(`existsTest('PKOS-transfer.json').then(v=>!v)`));

 // 4. 지문이 다르면(밖에서 바뀜) 손대지 않는다
 await evaluate(`(async()=>{
  await writeTest('source/changed.png',new Uint8Array([1,2,3]));
  const journal={v:1,mode:'move',startedAt:Date.now(),phase:'indexed',sources:[{id:'local:source/changed.png',hash:'chunks-v1:not-the-same'}],created:[],docs:[]};
  await writeTest('PKOS-transfer.json',JSON.stringify(journal));
  await pkosLocal.attach(testRoot);
 })()`);
 check('지문이 다른 파일은 그대로 둔다', await evaluate(`existsTest('source/changed.png')`));
 check('그래도 복구 기록은 닫는다', await evaluate(`existsTest('PKOS-transfer.json').then(v=>!v)`));

 // 5. 옮기는 도중 실패(대상 검증 실패)해도 사본이 남지 않는다 · 존재하지 않는 대상 폴더로 옮겨 실패시킨다
 const failed = await evaluate(`pkosLocal.transfer({fileId:'local:target/data.png'},['nowhere'],'move').then(()=>false,e=>e.message)`);
 check('없는 폴더로는 옮기지 못한다', typeof failed === 'string');
 check('실패 뒤 복구 기록 없음', await evaluate(`existsTest('PKOS-transfer.json').then(v=>!v)`));
 check('실패 뒤 원본 그대로', await evaluate(`readTest('target/data.png').then(f=>f.size===5)`));
 check('실행 오류 없음', !errors.length, errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
