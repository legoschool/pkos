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
 const make=(id,title,tags,relations=[],trashed=false)=>({id,title,tags,relations,trashed,type:'material',createdAt:1,updatedAt:1,blocks:[{id:id+'-b',kind:'text',text:'본문'}]});
 const seed=[make('a','기준 기록',['수업'],[{to:'bridge',label:'참고'}]),make('tag','태그로 찾은 자료',['수업']),make('graph','연결로 찾은 자료',[],[{to:'bridge',label:'참고'}]),make('bridge','공통 참고자료',[]),make('other','무관한 기록',['개발']),make('deleted','지운 수업 자료',['수업'],[],true)];
 seed[0].tags.push('sharedtoken'.repeat(30));seed[1].tags.push('sharedtoken'.repeat(30));seed[1].title+='longtitle'.repeat(35);
 await evaluate(`localStorage.setItem('pkos.entries.v2',${JSON.stringify(JSON.stringify(seed))})`);await send('Page.reload');await wait(1200);
 const open=async()=>{await evaluate(`(()=>{document.querySelector('[data-page="library"].nav-item').click();const q=document.querySelector('#search');q.value='기준 기록';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.card.entry .dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('전체 보기')).click();})()`);await wait(200);};
 await evaluate(`(async()=>{await pkosLocal.attach(await navigator.storage.getDirectory());})()`);
 await open();
 check('tag reason shown',await evaluate(`document.querySelector('[data-related-id="tag"]').textContent.includes('공통 태그: #수업')`));
 check('shared reference reason shown',await evaluate(`document.querySelector('[data-related-id="graph"]').textContent.includes('함께 연결한 기록: 공통 참고자료')`));
 check('unrelated/deleted/direct records excluded',await evaluate(`!document.querySelector('[data-related-id="other"], [data-related-id="deleted"], [data-related-id="bridge"]')`));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const overflow=await evaluate(`Math.max(document.querySelector('.vpaper').scrollWidth-document.querySelector('.vpaper').clientWidth,document.documentElement.scrollWidth-innerWidth)`);
 check('long related titles and tags fit narrow screen',overflow<=1,String(overflow));
 if(overflow>1)console.log(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+2).slice(0,15).map(e=>({tag:e.tagName,cls:e.className,width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right})))`));
 await send('Emulation.clearDeviceMetricsOverride');
 check('suggestion does not auto-connect',await evaluate(`JSON.parse(localStorage.getItem('pkos.entries.v2')).find(n=>n.id==='a').relations.length===1`));
 await evaluate(`document.querySelector('[data-related-id="tag"] .primary').click()`);
 check('chosen relation saved with reason',await evaluate(`JSON.parse(localStorage.getItem('pkos.entries.v2')).find(n=>n.id==='a').relations.some(r=>r.to==='tag'&&r.label.includes('#수업'))`));
 await wait(600);
 check('relation written to folder index',await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();const index=JSON.parse(await (await (await root.getFileHandle('PKOS-index.json')).getFile()).text());return index.entries.find(n=>n.id==='a').relations.some(r=>r.to==='tag'&&r.label.includes('#수업'));})()`));
 check('connected candidate removed from suggestions',await evaluate(`!document.querySelector('[data-related-id="tag"]')`));
 await evaluate(`document.querySelector('[data-related-id="graph"] button').click()`);
 check('candidate opens directly',await evaluate(`document.querySelector('.viewer h1').textContent==='연결로 찾은 자료'`));
 await send('Page.reload');await wait(1200);await open();
 check('relation survives reload',await evaluate(`document.querySelector('.viewer .relchips').textContent.includes('태그로 찾은 자료')`));
 check('no runtime errors',!errors.length,errors.join('\n'));
 if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
