/* 녹음 창의 받아쓰기 · 「받아쓴 글」 칸이 보이고, 녹음을 마치면 소리 파일 아래 «받아쓴 글 · 다듬기 전» 글 블록이 들어가는지 본다 (2026-09-17).
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
    녹음 창에 「받아쓴 글」 칸이 다시 보이고, 녹음을 마치면 소리 파일 아래 «받아쓴 글 · 다듬기 전» 글 블록이 들어가는지.
    가짜 마이크로 녹음한다. 브라우저 음성인식은 머리 없는 창에서 서비스에 못 붙으므로, 받아 적힌 글은 칸에 직접 넣어 흉내 낸다.
    기록 저장은 사람이 누르는 것이라 «저절로 저장되지 않음» 도 본다. */
 await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();try{await root.removeEntry('voice-test',{recursive:true});}catch{}const dir=await root.getDirectoryHandle('voice-test',{create:true});await pkosLocal.attach(dir);})()`);
 await evaluate(`document.querySelector('.nav-item[data-page="library"]').click()`); await wait(400);
 const before = await evaluate(`pkosLocal.entries().length`);
 const opened = await evaluate(`(()=>{const bar=document.getElementById('addbar');if(bar&&!bar.classList.contains('open'))document.getElementById('btnAddMore').click();const b=document.querySelector('[data-add="voice"]');if(!b)return 'NO_BUTTON';b.click();return document.querySelector('.voiceclock')?'OPEN':'NO_PANEL';})()`);
 check('녹음 창이 열린다', opened === 'OPEN', String(opened));
 check('「받아쓴 글」 칸이 보인다', await evaluate(`(()=>{const m=document.querySelector('.card.modal');const lab=Array.from(m.querySelectorAll('label')).find(l=>l.textContent==='받아쓴 글');return !!lab&&!lab.parentElement.hidden&&!!m.querySelector('textarea');})()`));
 check('브라우저 음성인식이 있다 (크롬·엣지)', await evaluate(`!!(window.SpeechRecognition||window.webkitSpeechRecognition)`));
 await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b=>b.textContent.includes('녹음 시작')).click(); true`);
 let rc = { clock: '0:00', status: '' };
 for (let i = 0; i < 20; i++) { await wait(400); rc = JSON.parse(await evaluate(`JSON.stringify({clock:(document.querySelector('.voiceclock')||{}).textContent,status:(document.querySelector('.mfoot .desc')||{}).textContent||''})`)); if (rc.clock !== '0:00' && rc.status.includes('녹음 중')) break; }
 check('녹음이 돈다', rc.clock !== '0:00' && rc.status.includes('녹음 중'), JSON.stringify(rc));
 // 받아 적힌 글을 칸에 넣는다 (음성인식 결과를 흉내)
 await evaluate(`(()=>{const ta=document.querySelector('.card.modal textarea');ta.value='오늘 협의회에서 나온 이야기';ta.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.card.modal .field input.inp').value='협의회';})()`);
 await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b=>b.textContent.includes('녹음 마치고')).click(); true`);
 let inserted = null;
 for (let i = 0; i < 30; i++) { await wait(500); inserted = JSON.parse(await evaluate(`JSON.stringify({modal:!!document.querySelector('.voiceclock'),files:document.querySelectorAll('#blocks .atom[data-kind="file"]').length,text:document.querySelector('#blocks')?document.querySelector('#blocks').innerText:''})`)); if (!inserted.modal && inserted.files) break; }
 check('녹음 파일 블록이 들어간다', inserted.files >= 1, JSON.stringify(inserted).slice(0, 160));
 check('받아쓴 글이 «받아쓴 글 · 다듬기 전» 머리를 달고 들어간다', inserted.text.includes('받아쓴 글 · 다듬기 전') && inserted.text.includes('오늘 협의회에서 나온 이야기'), inserted.text.slice(0, 160));
 const order = await evaluate(`(()=>{const kids=Array.from(document.querySelectorAll('#blocks > *'));const f=kids.findIndex(k=>k.matches('.atom[data-kind="file"]'));const t=kids.findIndex(k=>(k.innerText||'').includes('받아쓴 글 · 다듬기 전'));return JSON.stringify({f,t});})()`);
 check('글 블록이 소리 파일 아래에 온다', (() => { const o = JSON.parse(order); return o.f >= 0 && o.t > o.f; })(), order);
 check('제목·파일명에 받아쓴 문장이 들어가지 않는다', await evaluate(`!(document.getElementById('title').value||'').includes('협의회에서 나온')`));
 check('기록은 저절로 저장되지 않는다', (await evaluate(`pkosLocal.entries().length`)) === before);
 // 받아쓴 글이 비면 글 블록을 넣지 않는다
 await evaluate(`(()=>{document.querySelector('#blocks').innerHTML='';const bar=document.getElementById('addbar');if(bar&&!bar.classList.contains('open'))document.getElementById('btnAddMore').click();document.querySelector('[data-add="voice"]').click();})()`); await wait(300);
 await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b=>b.textContent.includes('녹음 시작')).click(); true`); await wait(1500);
 await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b=>b.textContent.includes('녹음 마치고')).click(); true`);
 let second = null;
 for (let i = 0; i < 30; i++) { await wait(500); second = JSON.parse(await evaluate(`JSON.stringify({modal:!!document.querySelector('.voiceclock'),files:document.querySelectorAll('#blocks .atom[data-kind="file"]').length,text:document.querySelector('#blocks').innerText})`)); if (!second.modal && second.files) break; }
 check('받아쓴 글이 없으면 소리 파일만 들어간다', second.files >= 1 && !second.text.includes('받아쓴 글 · 다듬기 전'), JSON.stringify(second).slice(0, 120));
 check('실행 오류 없음', !errors.length, errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
