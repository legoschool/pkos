import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
 check('startup editor',await evaluate(`document.body.dataset.page==='library'`));
 await evaluate(`document.getElementById('btnHome').click()`);await wait(200);
 check('brand opens knowledge home',await evaluate(`document.body.dataset.page==='home'&&document.getElementById('homePage').textContent.includes('연결이 많은 기록')&&document.getElementById('homePage').textContent.includes('자주 등장한 단어')`));
 check('todo navigation removed',await evaluate(`!document.querySelector('[data-go="todo"]')&&!Array.from(document.querySelectorAll('.smartrow')).some(b=>b.textContent.includes('할 일'))`));
 const source=readFileSync('index.html','utf8');const algorithm=source.slice(source.indexOf('  function knowledgeAnalysis('),source.indexOf('  function isInbox('));
 check('shared words and frequencies',await evaluate(`(()=>{${algorithm};const ns=[{id:'a',title:'수업 질문',blocks:[{text:'수업 질문 질문'}]},{id:'b',title:'수업 질문',blocks:[]},{id:'c',title:'바다 여행',blocks:[]}];const a=knowledgeAnalysis(ns);return a.edges.length===1&&a.edges[0].words.includes('질문')&&a.degree.get('a')===1&&a.words.find(x=>x[0]==='질문')[1]===4;})()`));
 await evaluate(`(()=>{const ns=pkosLocal.entries(),base=ns[0];ns.push({...base,id:'analysis-a',title:'수업 질문',blocks:[{kind:'text',text:'수업 질문 평가'}],tags:['현재태그']},{...base,id:'analysis-b',title:'수업 질문',blocks:[{kind:'text',text:'수업 질문 평가'}],tags:['현재태그']},{...base,id:'analysis-deleted',trashed:true,tags:['삭제태그']},{...base,id:'analysis-missing',_missing:true,tags:['사라진태그']});document.querySelector('[data-page="library"]').click();document.querySelector('[data-go="graph"]').click();})()`);await wait(300);
 check('graph excludes deleted tags',await evaluate(`(()=>{Array.from(document.querySelectorAll('.graphtools button')).find(b=>b.textContent.includes('태그')).click();return !document.querySelector('.modal').textContent.includes('삭제태그');})()`));
 check('sidebar excludes missing tags',await evaluate(`!document.querySelector('#sideNav').textContent.includes('사라진태그')&&!document.querySelector('#sideNav').textContent.includes('삭제태그')`));
 await evaluate(`Array.from(document.querySelectorAll('.graphtools button')).find(b=>b.textContent==='단어 관계망').click()`);await wait(250);
 check('word network opens',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('단어')&&!!document.querySelector('#graphCanvas')`));
 for(const width of [390,768,1280]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await wait(200);check('graph viewport '+width,await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));}
 await evaluate(`document.querySelector('.graphmodal .mhead button').click();document.querySelector('#webTools button').click()`);
 check('clipper opens',await evaluate(`!!document.querySelector('[aria-label="출처 주소"]')`));
 await evaluate(`document.querySelector('[aria-label="출처 주소"]').value='javascript:alert(1)';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='기록에 넣기').click()`);
 check('unsafe URL rejected',await evaluate(`document.querySelector('.modal').textContent.includes('http 또는 https')`));
 await evaluate(`document.querySelector('[aria-label="출처 주소"]').value='https://example.com/article';document.querySelector('[aria-label="클립 제목"]').value='클립 시험';document.querySelector('[aria-label="가져온 글"]').value='선택한 글 시험';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='기록에 넣기').click()`);await wait(200);
 check('clip becomes draft with source',await evaluate(`document.querySelector('#blocks').textContent.includes('선택한 글 시험')&&document.querySelector('#blocks').textContent.includes('https://example.com/article')`));
 await evaluate(`document.querySelector('#webTools button').click();document.querySelector('[aria-label="출처 주소"]').value='https://example.com/';document.querySelector('[aria-label="클립 제목"]').value='사이트 시험';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='사이트 추가').click()`);
 check('site shortcut stored',await evaluate(`document.querySelector('#webTools a').href==='https://example.com/'`));
 await evaluate(`document.querySelector('#webTools button').click();window.clipBookmark=document.querySelector('.modal a').href;document.querySelector('.modal .mhead button').click();location.hash='#clip='+encodeURIComponent(JSON.stringify({title:'수신 시험',url:'https://example.org/',text:'수신 내용'}))`);await wait(200);
 check('bookmark clip received for review',await evaluate(`document.querySelector('[aria-label="가져온 글"]').value==='수신 내용'&&clipBookmark.startsWith('javascript:')`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.querySelector('[data-add="capture"]').click()`);
 check('capture has buttons only',await evaluate(`!document.querySelector('.sheetnote,.sheetbtn small,.sheettoggle')&&!document.querySelector('.modal').textContent.includes('클립보드')`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.getElementById('btnHome').click()`);await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await wait(200);
 mkdirSync('local-service/runtime',{recursive:true});writeFileSync('local-service/runtime/knowledge-home.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await wait(200);check('home mobile viewport',await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));writeFileSync('local-service/runtime/knowledge-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 check('no exceptions',errors.length===0,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
