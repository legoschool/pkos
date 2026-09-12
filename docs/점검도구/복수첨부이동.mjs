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
 const result=await evaluate(`(async()=>{
 const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('multi-move',{create:true});
 async function put(d,n,data){const h=await d.getFileHandle(n,{create:true});const w=await h.createWritable();await w.write(data);await w.close();}
 await put(folder,'photo.png','image-bytes');await put(folder,'video.mp4','video-bytes');
 await put(folder,'a.md','# Multi\\n\\n![photo](photo.png)\\n\\n📎 [video](video.mp4)');
 await put(folder,'b.md','# Shared\\n\\n![photo](photo.png)');
 let interrupted=false;
 const wrapped=new Proxy(folder,{get(target,key){if(key==='entries')return async function*(){for await(const [name,handle] of target.entries()){if(name==='photo.png'&&!interrupted){yield [name,new Proxy(handle,{get(h,k){if(k==='getFile')return async()=>{if(!interrupted){interrupted=true;throw new DOMException('transient scan','NotFoundError');}return h.getFile();};const v=h[k];return typeof v==='function'?v.bind(h):v;}})];}else yield [name,handle];}};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 if(!await pkosLocal.attach(wrapped))throw Error('attach failed');if(!interrupted)throw Error('retry case not exercised');
 const a=pkosLocal.entries().find(n=>n.mdName==='a.md'),b=pkosLocal.entries().find(n=>n.mdName==='b.md');
 const aid=a.id,bid=b.id,video=a.blocks.find(b=>b.name==='video.mp4');
 const sub=await folder.getDirectoryHandle('사진 (이동)',{create:true});await put(sub,'새 사진 (1).png','image-bytes');await folder.removeEntry('photo.png');
 await pkosLocal.importAll(null,{quiet:true});
 const updated=[a,b].map(n=>n.blocks.find(b=>b.kind==='image'));
 if(updated.some(b=>b.fileId!=='local:사진 (이동)/새 사진 (1).png'))throw Error('shared references not moved');
 if(a.id!==aid||b.id!==bid||video.fileId!=='local:video.mp4'||a.localDir!==''||b.localDir!=='')throw Error('other content moved');
 const md=await (await (await folder.getFileHandle('a.md')).getFile()).text();
 if(!md.includes('%EC%82%AC%EC%A7%84%20%28%EC%9D%B4%EB%8F%99%29/')||md.includes('](local://'))throw Error('relative Markdown not encoded');
 await put(folder,'a.md',md+'\\nExternal edit');await pkosLocal.importAll(null,{quiet:true});
 const parsed=pkosLocal.entries().find(n=>n.id===aid);
 if(!parsed.blocks.some(b=>b.fileId==='local:사진 (이동)/새 사진 (1).png')||!parsed.blocks.some(b=>b.fileId==='local:video.mp4'))throw Error('external edit broke relative links');
 return {records:pkosLocal.entries().length,sharedReferences:updated.length};
 })()`);
 check('복수 첨부·공유 참조 이동, 다른 첨부 보존, 상대 경로 재읽기',result.records===2,JSON.stringify(result));
 if(errors.length||results.some(r=>!r.ok))throw Error(errors.join('\n')||'check failed');
 console.log('PASS multiple attachment relocation');
}finally{ws.close();edge.kill();}
