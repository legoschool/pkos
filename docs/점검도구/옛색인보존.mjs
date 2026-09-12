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
 await evaluate(`(async()=>{window.testRoot=await navigator.storage.getDirectory();window.put=async(root,path,text)=>{let parts=path.split('/'),d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p,{create:true});let w=await (await d.getFileHandle(parts.at(-1),{create:true})).createWritable();await w.write(text);await w.close();};window.legacy=await testRoot.getDirectoryHandle('legacy',{create:true});const e=id=>({id,title:id,type:'material',createdAt:1,updatedAt:1,mdId:'remote-'+id,blocks:[{id:id+'b',kind:'text',text:'본문'}],relations:id==='one'?[{to:'two',label:'기존 관계'}]:[]});await put(legacy,'TRACE-index.json',JSON.stringify({entries:[e('one'),e('two')],deleted:[]}));await put(legacy,'one.md','---\\nid: one\\ntitle: one\\n---\\n본문');await put(legacy,'two.md','---\\nid: two\\ntitle: two\\n---\\n본문');})()`);
 check('legacy index attaches',await evaluate(`pkosLocal.attach(legacy)`));
 check('legacy records retain IDs and local paths',await evaluate(`pkosLocal.entries().filter(n=>['one','two'].includes(n.id)&&n.mdId.startsWith('local:')).length===2`));
 check('legacy relation preserved',await evaluate(`pkosLocal.entries().find(n=>n.id==='one').relations.some(r=>r.to==='two'&&r.label==='기존 관계')`));
 check('new index contains relation',await evaluate(`(async()=>{const j=JSON.parse(await (await (await legacy.getFileHandle('PKOS-index.json')).getFile()).text());return j.entries.find(n=>n.id==='one').relations.length===1;})()`));
 await evaluate(`(async()=>{await pkosLocal.detach();window.bad=await testRoot.getDirectoryHandle('bad',{create:true});await put(bad,'PKOS-index.json','{broken original');})()`);
 check('corrupt index refuses attachment',!(await evaluate(`pkosLocal.attach(bad)`)));
 await wait(2600);
 check('corrupt index remains untouched after timer',await evaluate(`(async()=>{return (await (await (await bad.getFileHandle('PKOS-index.json')).getFile()).text())==='{broken original'&&!pkosLocal.isOn();})()`));
 if(process.argv[3]) {
  const fs=await import('node:fs'),path=await import('node:path'),root=process.argv[3];const index=fs.readFileSync(path.join(root,'TRACE-index.json'),'utf8');const original=JSON.parse(index.replace(/^\uFEFF/,''));
  let texts=[['TRACE-index.json',index]];const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else if(/\.md$/i.test(item.name))texts.push([path.relative(root,p).split(path.sep).join('/'),fs.readFileSync(p,'utf8')]);}};walk(root);
  check("actual Markdown files included",texts.length > 1,String(texts.length-1));
  await evaluate(`(async()=>{window.realCopy=await testRoot.getDirectoryHandle('actual-copy',{create:true});for(const [path,text] of ${JSON.stringify(texts)})await put(realCopy,path,text);})()`);
  check('read-only copy of actual legacy folder loads',await evaluate(`pkosLocal.attach(realCopy)`));
  const info=await evaluate(`pkosLocal.entries().map(n=>({id:n.id,local:!!n.mdId&&n.mdId.startsWith('local:'),relations:(n.relations||[]).length}))`);
  check('actual original IDs and relations preserved',original.entries.every(n=>info.some(x=>x.id===n.id&&x.relations===(n.relations||[]).length)),JSON.stringify({original:original.entries.length,relations:original.entries.reduce((s,n)=>s+(n.relations||[]).length,0)}));
 }
 check('no runtime errors',!errors.length,errors.join('\n'));
 if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
