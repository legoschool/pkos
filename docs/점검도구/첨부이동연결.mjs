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
 await evaluate(String.raw`(async()=>{
  const root=window.PKOSBridge?.enabled?await PKOSBridge.root():await navigator.storage.getDirectory();window.linkRoot=await root.getDirectoryHandle('link-move',{create:true});
  window.writeLink=async(p,data)=>{let d=linkRoot;const ps=p.split('/');for(const s of ps.slice(0,-1))d=await d.getDirectoryHandle(s,{create:true});const h=await d.getFileHandle(ps.at(-1),{create:true});const w=await h.createWritable();await w.write(data);await w.close();};
  window.readLink=async(p)=>{let d=linkRoot;const ps=p.split('/');for(const s of ps.slice(0,-1))d=await d.getDirectoryHandle(s);return (await d.getFileHandle(ps.at(-1))).getFile();};
  window.originalLink='\uFEFF---\r\nid: link-original\r\ntitle: 연결 시험\r\ncustom: KEEP\r\n---\r\n<!-- KEEP COMMENT ![주석](data.png) -->\r\n<!--\r\n![긴 주석](data.png)\r\n-->\r\n![그림](data.png)\r\n[원본 사이트](https://example.com/data.png)\r\n~~~text\r\n![예시](data.png)\r\n~~~\r\n';
  await writeLink('source/note.md',originalLink);await writeLink('source/other.md','---\nid: link-other\ntitle: 함께 쓰는 기록\n---\n![공유](data.png)\n');
  await writeLink('source/data.png',new Uint8Array([1,2,3,4]));await linkRoot.getDirectoryHandle('target',{create:true});await pkosLocal.attach(linkRoot);
 })()`);
 await evaluate(`pkosLocal.transfer({fileId:'local:source/data.png'},['target'],'move')`);
 check('Saved Markdown attachment follows moved file',await evaluate(`readLink('source/note.md').then(f=>f.text()).then(t=>t.includes('![그림](../target/data.png)'))`));
 check('Shared referencing Markdown updated',await evaluate(`readLink('source/other.md').then(f=>f.text()).then(t=>t.includes('![공유](../target/data.png)'))`));
 check('Source document formatting and examples preserved',await evaluate(`readLink('source/note.md').then(f=>f.arrayBuffer()).then(b=>new TextDecoder('utf-8',{ignoreBOM:true}).decode(b)===originalLink.replace('![그림](data.png)','![그림](../target/data.png)'))`));
 check('Moved file bytes unchanged',await evaluate(`readLink('target/data.png').then(f=>f.arrayBuffer()).then(b=>JSON.stringify([...new Uint8Array(b)])==='[1,2,3,4]')`));


 await evaluate(String.raw`(async()=>{
  await writeLink('extra/note.md','---\nid: advanced-links\ntitle: 복합 링크\nattachments:\n  - file: "그림 (1).png"\n    driveId: "local:extra/그림 (1).png"\n---\n![그림](%EA%B7%B8%EB%A6%BC%20%281%29.png "설명")\n[ref]: <%EA%B7%B8%EB%A6%BC%20%281%29.png> "제목"\n<img src="%EA%B7%B8%EB%A6%BC%20%281%29.png">\n');
  await writeLink('extra/그림 (1).png',new Uint8Array([8,7,6]));await writeLink('target/그림 (1).png','KEEP COLLISION');await pkosLocal.attach(linkRoot);
 })()`);
 const advanced=await evaluate(`pkosLocal.transfer({fileId:'local:extra/그림 (1).png'},['target'],'move')`);
 check('Collision gives moved attachment a distinct name',advanced.paths[0]!=='local:target/그림 (1).png');
 await evaluate(`window.advancedDestination=${JSON.stringify(advanced.paths[0])}`);
 check('Encoded paths, titles, HTML and reference definitions updated',await evaluate(`readLink('extra/note.md').then(f=>f.text()).then(t=>{const rel='../'+advancedDestination.slice(6).split('/').map(p=>encodeURIComponent(p).replace(/[()]/g,c=>'%'+c.charCodeAt(0).toString(16))).join('/');return t.includes(']('+rel+' "설명")')&&t.includes(']: <'+rel+'> "제목"')&&t.includes('src="'+rel+'"');})`));
 check('Attachment metadata follows renamed destination',await evaluate(`readLink('extra/note.md').then(f=>f.text()).then(t=>t.includes('driveId: '+JSON.stringify(advancedDestination))&&t.includes('file: '+JSON.stringify(advancedDestination.split('/').at(-1))))`));
 check('Existing destination file preserved',await evaluate(`readLink('target/그림 (1).png').then(f=>f.text()).then(t=>t==='KEEP COLLISION')`));
 await wait(30);
 await evaluate(`writeLink('extra/note.md','EXTERNAL USER EDIT')`);
 check('Externally edited referencing document blocks move',await evaluate(`pkosLocal.transfer({fileId:advancedDestination},['source'],'move').then(()=>false,()=>true)`));
 check('External edit and attachment remain intact',await evaluate(`Promise.all([readLink('extra/note.md').then(f=>f.text()),readLink(advancedDestination.slice(6)).then(f=>f.size)]).then(([t,size])=>t==='EXTERNAL USER EDIT'&&size===3)`));
 await send('Page.reload');await wait(1600);await evaluate(`(async()=>{const r=window.PKOSBridge?.enabled?await PKOSBridge.root():await navigator.storage.getDirectory();await pkosLocal.attach(await r.getDirectoryHandle('link-move'));})()`);
 check('Reimported attachments keep destination path',await evaluate(`pkosLocal.entries().filter(n=>['link-original','link-other'].includes(n.id)).every(n=>n.blocks.some(b=>b.fileId==='local:target/data.png'))`));
 check('No runtime errors',!errors.length,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
