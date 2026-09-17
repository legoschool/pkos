/* 엮어내기 창의 「묶음으로 저장」 · 고른 기록이 검색 묶음에 남고 그 묶음을 열면 그 기록들만 보이는지 본다 (2026-09-17).
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
    엮어내기 창에서 고른 기록을 «묶음으로 저장» 하면 검색 묶음에 남고, 그 묶음을 열면 그 기록들만 보이는지.
    브라우저 안 폴더(OPFS)만 쓴다. */
 await evaluate(`(async()=>{
  const root=await navigator.storage.getDirectory();
  try{await root.removeEntry('group-test',{recursive:true});}catch{}
  const dir=await root.getDirectoryHandle('group-test',{create:true});window.testRoot=dir;
  window.writeTest=async(path,data)=>{let d=testRoot;const ps=path.split('/');for(const p of ps.slice(0,-1))d=await d.getDirectoryHandle(p,{create:true});const h=await d.getFileHandle(ps.at(-1),{create:true});const w=await h.createWritable();await w.write(data);await w.close();};
  for(const [id,title] of [['g-a','수업 준비'],['g-b','학급 회의'],['g-c','연수 정리']]) await writeTest(id+'.md','---\\nid: '+id+'\\ntitle: '+title+'\\ntype: 자료\\ncreated: 2026-09-17\\n---\\n\\n'+title+' 본문\\n');
  await pkosLocal.attach(dir);
 })()`);
 check('기록 세 편 가져오기', await evaluate(`['g-a','g-b','g-c'].every(id=>pkosLocal.entries().some(n=>n.id===id))`));
 await evaluate(`document.querySelector('.nav-item[data-page="library"]').click()`); await wait(400);
 await evaluate(`document.getElementById('btnCompile').click()`); await wait(400);
 check('엮어내기 창이 열린다', await evaluate(`!!document.querySelector('.modal .picklist')`));
 check('「묶음으로 저장」 단추가 있다', await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).some(b=>b.textContent==='묶음으로 저장')`));
 // g-b 만 빼고 고른다 · 책 제목 칸이 묶음 이름
 await evaluate(`(()=>{const rows=Array.from(document.querySelectorAll('.modal .picklist .pickrow'));const off=rows.find(r=>r.__id==='g-b');off.__cb.checked=false;off.__cb.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.modal .mbody input.inp').value='이번 주 볼 것';})()`);
 await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='묶음으로 저장').click()`); await wait(700);
 check('창이 닫힌다', await evaluate(`!document.querySelector('.modal .picklist')`));
 const saved = await evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('pkos.settings.v1')||'{}');const g=(s.savedSearches||[]).find(x=>x.name==='이번 주 볼 것');return g?JSON.stringify(g.ids):'none';})()`).catch(()=>'err');
 check('묶음이 설정에 남는다 (고른 두 편)', saved !== 'none' && saved !== 'err' && JSON.parse(saved).sort().join(',') === 'g-a,g-c', saved);
 // 검색 묶음 목록에서 열기
 await evaluate(`(()=>{const d=document.querySelector('#savedSearches details');d.open=true;})()`); await wait(200);
 check('검색 묶음 목록에 보인다', await evaluate(`Array.from(document.querySelectorAll('#savedSearches button')).some(b=>b.textContent==='이번 주 볼 것')`));
 await evaluate(`Array.from(document.querySelectorAll('#savedSearches button')).find(b=>b.textContent==='이번 주 볼 것').click()`); await wait(600);
 const shown = await evaluate(`Array.from(document.querySelectorAll('.card.entry')).map(c=>c.textContent).join('|')`);
 check('묶음을 열면 고른 기록만 보인다', shown.includes('수업 준비') && shown.includes('연수 정리') && !shown.includes('학급 회의'), shown.slice(0, 120));
 check('필터 지우기 칩이 보인다', await evaluate(`!!document.querySelector('.clearchip')`));
 await evaluate(`document.querySelector('.clearchip').click()`); await wait(500);
 check('필터를 지우면 셋 다 보인다', await evaluate(`(()=>{const t=Array.from(document.querySelectorAll('.card.entry')).map(c=>c.textContent).join('|');return t.includes('학급 회의');})()`));
 // 같은 이름은 거부
 await evaluate(`document.getElementById('btnCompile').click()`); await wait(400);
 await evaluate(`(()=>{document.querySelector('.modal .mbody input.inp').value='이번 주 볼 것';Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='묶음으로 저장').click();})()`); await wait(400);
 check('같은 이름의 묶음은 다시 만들지 않는다', await evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('pkos.settings.v1')||'{}');return (s.savedSearches||[]).filter(x=>x.name==='이번 주 볼 것').length===1;})()`));
 check('실행 오류 없음', !errors.length, errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
