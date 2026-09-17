/* 「레고 블록」 색감 · 목록에 있고, 고르면 종이 바탕·먹빛 2px 테두리·툭 그림자·왼쪽 색 블록·노란 제목판이 실제 픽셀값으로 서는지 · 어둡게도 (2026-09-17). 셋째 인수로 png 경로를 주면 화면을 찍는다.
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
    「레고 블록」 색감이 목록에 있고, 고르면 종이 바탕·먹빛 2px 테두리·툭 떨어진 그림자·돌기가 실제 픽셀값으로 서는지.
    밝을 때와 어둡게 골랐을 때를 다 본다. 화면 두 장을 찍어 둔다. */
 const SHOT = process.argv[3] || "";
 const fs = await import("node:fs");
 async function snap(name) { if (!SHOT) return; const shot = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(SHOT.replace(/\.png$/, "") + "-" + name + ".png", Buffer.from(shot.data, "base64")); }
 async function boot(mode) {
   await evaluate(`localStorage.setItem('pkos.settings.v1',JSON.stringify({lookV2:true,lookV3:true,theme:'lego',tone:'brick',mode:'${mode}',fontSize:'',viewMode:'stream'}))`);
   await send("Page.reload"); await wait(1500);
   await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();try{await root.removeEntry('brick-test',{recursive:true});}catch{}const dir=await root.getDirectoryHandle('brick-test',{create:true});const h=await dir.getFileHandle('b.md',{create:true});const w=await h.createWritable();await w.write('---\\nid: brick-1\\ntitle: 블록 시험\\ntype: 자료\\ncreated: 2026-09-17\\n---\\n\\n본문\\n');await w.close();await pkosLocal.attach(dir);})()`);
   await evaluate(`document.querySelector('.nav-item[data-page="library"]').click()`); await wait(600);
 }
 await boot("light");
 check("색감이 레고 블록으로 선다", await evaluate(`document.documentElement.getAttribute('data-tone')`) === "brick");
 let st = JSON.parse(await evaluate(`(()=>{const row=document.querySelector('.listcol .entry');const r=row?getComputedStyle(row):null;const b=row?getComputedStyle(row,'::before'):null;const paper=document.querySelector('.paper');const pp=paper?getComputedStyle(paper):null;return JSON.stringify({line:document.documentElement.style.getPropertyValue('--line').trim(),bg:getComputedStyle(document.body).backgroundColor,rowLeft:r&&r.borderLeftWidth,rowShadow:r&&r.boxShadow,stud:b&&b.display,paperBw:pp&&pp.borderLeftWidth,paperShadow:pp&&pp.boxShadow,btn:(()=>{const p=document.querySelector('.btn.primary');return p?getComputedStyle(p).boxShadow:''})()});})()`));
 check("선 색이 먹빛(#172b43)", st.line === "#172b43", st.line);
 check("바탕이 종이색(#F4F2E9)", st.bg === "rgb(244, 242, 233)", st.bg);
 check("목록 줄 왼쪽에 6px 색 블록", st.rowLeft === "6px", String(st.rowLeft));
 check("목록 줄에 작은 툭 그림자 (2px 2px 0)", /2px 2px 0px/.test(st.rowShadow || ""), st.rowShadow);
 check("목록 줄에는 돌기를 그리지 않는다 (제목과 겹치므로)", st.stud === "none", String(st.stud));
 check("편집 종이 테두리 2px 먹빛", st.paperBw === "2px", String(st.paperBw));
 check("편집 종이 그림자 «툭» (3px 4px 0)", /3px 4px 0px/.test(st.paperShadow || ""), st.paperShadow);
 check("으뜸 단추도 툭 그림자", /2px 3px 0px/.test(st.btn || ""), st.btn);
 await evaluate(`document.querySelector('.nav-item[data-page="home"]').click()`); await wait(700);
 const home = JSON.parse(await evaluate(`(()=>{const c=document.querySelector('.knowledge-card');const cs=c?getComputedStyle(c):null;const h=document.querySelector('#homePage h1');const hs=h?getComputedStyle(h):null;return JSON.stringify({cardBw:cs&&cs.borderLeftWidth,cardTop:cs&&cs.borderTopWidth,cardShadow:cs&&cs.boxShadow,h1Bg:hs&&hs.backgroundColor,h1Bw:hs&&hs.borderLeftWidth});})()`));
 check("지식 홈 자료 카드가 2px 블록 · 위 색줄 8px · 툭 그림자", home.cardBw === "2px" && home.cardTop === "8px" && /3px 4px 0px/.test(home.cardShadow || ""), JSON.stringify(home));
 check("지식 홈 제목이 노란 판", home.h1Bg === "rgb(255, 205, 41)" && home.h1Bw === "2px", JSON.stringify(home));
 await snap("light");
 // 설정 → 모양 에서 고를 수 있다
 await evaluate(`document.getElementById('btnSettings').click()`); await wait(400);
 await evaluate(`(()=>{const t=Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='모양');if(t)t.click();})()`); await wait(400);
 check("모양 설정에 「레고 블록」 이 있다", await evaluate(`(()=>{const b=document.querySelector('.tonebtn[data-tone="brick"]');return !!b&&b.textContent.includes('레고 블록')&&b.classList.contains('on');})()`));
 await evaluate(`document.querySelector('.tonebtn[data-tone="plain"]').click()`); await wait(200);
 check("다른 색감을 누르면 바로 바뀐다", await evaluate(`document.documentElement.getAttribute('data-tone')`) === "plain");
 await evaluate(`document.querySelector('.tonebtn[data-tone="brick"]').click()`); await wait(200);
 check("레고 블록을 다시 누르면 돌아온다", await evaluate(`document.documentElement.getAttribute('data-tone')==='brick'&&document.documentElement.style.getPropertyValue('--line').trim()==='#172b43'`));
 await evaluate(`(()=>{const x=document.querySelector('.modal .mhead .btn');if(x)x.click();})()`); await wait(200);
 // 어둡게
 await boot("dark");
 st = JSON.parse(await evaluate(`(()=>{const row=document.querySelector('.listcol .entry');const r=row?getComputedStyle(row):null;return JSON.stringify({line:document.documentElement.style.getPropertyValue('--line').trim(),bg:getComputedStyle(document.body).backgroundColor,ink:getComputedStyle(document.body).color,shadow:r&&r.boxShadow});})()`));
 check("어둡게: 선 색이 밝은 회청(#c9d4e3)", st.line === "#c9d4e3", st.line);
 check("어둡게: 바탕이 짙은 남색", st.bg === "rgb(18, 28, 43)", st.bg);
 check("어둡게: 글자가 밝다", st.ink === "rgb(238, 243, 250)", st.ink);
 check("어둡게: 그림자도 밝은 선으로", /201, 212, 227/.test(st.shadow || ""), st.shadow);
 await evaluate(`document.querySelector('.nav-item[data-page="home"]').click()`); await wait(700);
 await snap("dark");
 check("실행 오류 없음", !errors.length, errors.join(";"));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
