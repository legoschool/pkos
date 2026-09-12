/* 대비 점검 · 레고 한 모양 × 색감 여섯을 밝은/어두운 · 데스크톱/폰에서 «재 본다».

   눈으로 스물여덟 장을 보는 대신 수치로 훑는다. 보는 것:
     · 글자 대비 (WCAG 4.5:1) · 본문·제목·배지·날짜·태그·길찾기·단추·칩
     · 가로 넘침 (데스크톱·폰)
     · 카드가 다 그려지는가 · 자바스크립트 오류

   ⚠️ 프리셋의 색을 하나라도 손대면 반드시 돌리세요.
      토큰 하나 바꿨다가 어느 프리셋의 작은 글씨가 안 읽히게 되는 일이 실제로 있었습니다
      (블록놀이의 «아이디어» 배지가 3.15:1 이었습니다. 하필 아이가 볼 화면이었습니다).

   ⚠️ 배경 «색» 만 보면 안 됩니다. 기록 카드는 유형 색을 색으로 깔고 그 위에
      덮개(--veil)를 배경 «그림» 으로 칠합니다. 색만 보면 가려진 틴트를 배경으로 잘못 잡아
      멀쩡한 것을 «미달» 이라고 말합니다. 한 번 그렇게 짰다가 고쳤습니다.

   실행:  node docs/점검도구/대비점검.mjs <찍은 그림을 넣을 폴더> */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const OUT = process.argv[2] || ".";
/* ⚠️ 자리(포트)를 못 박아 두면, 점검이 도중에 죽었을 때 브라우저가 그 자리를
   문 채로 남는다. 다음 점검은 «자기 브라우저를 못 띄운 채» 남의 빈 탭에 붙어
   앱이 멀쩡한데도 「아무것도 없다」 고 말한다. 두 사람이 같이 돌려도 같은 일이
   난다. 자리는 «비어 있는 것을 그때그때» 받아 쓴다. */
const PORT = await new Promise((res, rej) => {
  const srv = createServer();
  srv.on("error", rej);
  srv.listen(0, "127.0.0.1", () => {
    const got = srv.address().port;
    srv.close(() => res(got));
  });
});
const BASE = process.argv[3] || "http://localhost:8000/";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const wait = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "audit-"));
const p = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--no-default-browser-check", "--disable-sync",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1000,1300",
  BASE], { stdio: "ignore" });
/* ⚠️ 끝에서만 p.kill() 을 부르면 도중에 넘어졌을 때 브라우저가 살아 남는다.
   나가는 «모든» 길에서 끄도록 여기서 한 번에 걸어 둔다. */
process.on("exit", () => { try { p.kill(); } catch {} });
["SIGINT", "SIGTERM"].forEach((sig) =>
  process.on(sig, () => { try { p.kill(); } catch {} process.exit(130); }));
let u;
for (let i = 0; i < 80 && !u; i++) {
  try { const l = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    u = l.find(t => t.type === "page" && t.webSocketDebuggerUrl && (t.url || "").startsWith(new URL(BASE).origin + "/"))?.webSocketDebuggerUrl; } catch {}
  if (!u) await wait(250);
}
const ws = new WebSocket(u); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener("open", r));
ws.addEventListener("message", e => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise(r => pend.set(i, r)); };
const ev = async e => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "실패"); return r.result?.value; };
await send("Runtime.enable"); await send("Page.enable"); await wait(2500);

const D = t => Date.parse(t);
const SEED = `(() => {
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
   {id:'a',type:'experience',title:'2단원 물의 상태변화 · 3차시 수업',tags:['2019','3학년','과학'],relations:[{to:'b',label:'이어서'}],
    blocks:[{id:'b1',kind:'text',text:'얼음이 녹는 동안 온도가 그대로라는 걸 아이들이 못 믿었다. 온도계를 직접 잡고 5분을 기다리게 했더니 그때야 «어?» 하는 소리가 나왔다.'}],
    createdAt:${D("2019-05-14")},updatedAt:${D("2019-05-14")},srcPath:['2019','3학년','과학'],srcId:'H0'},
   {id:'b',type:'material',title:'물의 상태변화 학습지',tags:['2019','3학년','과학'],relations:[],
    blocks:[{id:'b2',kind:'file',name:'학습지.hwp',mime:'application/octet-stream',size:1234,fileId:'H1'}],
    createdAt:${D("2019-03-02")},updatedAt:${D("2019-03-02")},srcPath:['2019','3학년','과학'],srcId:'H1'},
   {id:'c',type:'knowledge',title:'학급 세우기 연수 메모',tags:['연수'],relations:[],
    blocks:[{id:'b3',kind:'quote',text:'규칙을 먼저 정하지 말고, 규칙이 필요해지는 순간을 같이 겪으라고 했다.'}],
    createdAt:${D("2019-08-06")},updatedAt:${D("2019-08-06")},srcPath:['연수'],srcId:'M9'},
   {id:'d',type:'idea',title:'온도계를 아이 수만큼',tags:['과학'],relations:[],
    blocks:[{id:'b4',kind:'text',text:'한 모둠에 하나면 결국 한 명만 만진다.'}],
    createdAt:${D("2020-02-11")},updatedAt:${D("2020-02-11")},srcPath:['2020'],srcId:'M8'},
   {id:'e',type:'reflection',title:'3월을 다시 한다면',tags:['학급운영'],relations:[],
    blocks:[{id:'b5',kind:'text',text:'첫 주에 규칙을 스물세 개 적어 붙였다. 지킨 건 넷이었다.'}],
    createdAt:${D("2020-02-28")},updatedAt:${D("2020-02-28")},srcPath:['2020'],srcId:'M7'}
  ]));
  return true;
})()`;

/* 색 대비를 재는 잣대. WCAG 기준 · 본문 4.5:1, 큰 글씨 3:1 */
const MEASURE = `(() => {
  function rgb(s){ const m=/rgba?\\(([^)]+)\\)/.exec(s); if(!m) return null;
    const a=m[1].split(",").map(x=>parseFloat(x)); return {r:a[0],g:a[1],b:a[2],a:a.length>3?a[3]:1}; }
  function lum(c){ const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function over(fg,bg){ if(fg.a>=1) return fg;
    return {r:fg.r*fg.a+bg.r*(1-fg.a), g:fg.g*fg.a+bg.g*(1-fg.a), b:fg.b*fg.a+bg.b*(1-fg.a), a:1}; }
  /* ⚠️ 배경 «색» 만 보면 안 된다. 기록 카드는 유형 색을 색으로 깔고 그 위에
     덮개(--veil)를 배경 «그림» 으로 칠한다. 색만 보면 가려진 틴트를 배경으로 잘못 잡는다. */
  function bgOf(node){ let n=node;
    while(n && n!==document.documentElement){
      const cs=getComputedStyle(n);
      const veil=rgb(cs.backgroundImage||"");        // linear-gradient(색,색) 의 첫 색
      if(veil && veil.a>0.99) return veil;
      const c=rgb(cs.backgroundColor);
      if(c && c.a>0.99) return c;
      n=n.parentElement; }
    return rgb(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1}; }
  function ratio(node){ if(!node) return null;
    const cs=getComputedStyle(node); const fg=rgb(cs.color); const bg=bgOf(node);
    if(!fg||!bg) return null; const f=lum(over(fg,bg)), b=lum(bg);
    const hi=Math.max(f,b), lo=Math.min(f,b);
    return Math.round(((hi+0.05)/(lo+0.05))*100)/100; }
  function pick(sel){ return document.querySelector(sel); }
  const card = pick('.card.entry');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cards: document.querySelectorAll('.card.entry').length,
    본문: ratio(pick('.card.entry .content p')),
    제목: ratio(pick('.card.entry h3')),
    배지: ratio(pick('.card.entry .badge')),
    날짜: ratio(pick('.card.entry .when')),
    태그: ratio(pick('.card.entry .tag')),
    길찾기: ratio(pick('.card.entry .crumb')),
    단추: ratio(pick('.btn')),
    으뜸단추: ratio(pick('.btn.primary')),
    유형칩: ratio(pick('#typeChips .chip')),
    띠: ratio(pick('.banner')),
    돌기: card ? getComputedStyle(card,'::before').display : '',
    카드배경: card ? getComputedStyle(card).backgroundColor : ''
  };
})()`;

/* 모양은 레고 하나다. 색은 색감이 쥐므로, 모양 쪽은 한 벌만 재면 된다 */
const THEMES = ["lego"];
/* 색감 여섯. 색은 이제 «모양» 이 아니라 «색감» 이 쥐고 있다.
   그래서 색 대비는 색감마다 한 번씩만 재면 된다. 모양은 색을 안 건드리므로. */
const TONES = ["plain"];
const rows = [];
for (const th of THEMES) {
  for (const dark of [false, true]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await ev(SEED);
    await ev(`localStorage.setItem('pkos.settings.v1', JSON.stringify({version:1, lookV2:true, lookV3:true, tone:"plain", theme:'${th}', mode:'${dark ? 'dark' : 'light'}', viewMode:'stream', folderMode:'perEntry'})); true`);
    await send("Page.reload", { ignoreCache: true });
    await wait(2600);
    await ev(`(() => { const c=document.querySelector('.composer'); if(c) c.style.display='none'; return true; })()`);
    const m = JSON.parse(await ev(`JSON.stringify(${MEASURE})`));
    rows.push({ th, dark, ...m });
    // 폰 너비 넘침만 따로
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await wait(700);
    const mob = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    rows[rows.length - 1].폰넘침 = Number(mob);
    if (!dark) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, "폰-" + th + ".png"), Buffer.from(r.data, "base64"));
    }
    await send("Emulation.clearDeviceMetricsOverride");
    await wait(300);
    if (dark) {
      await wait(500);
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, "어둠-" + th + ".png"), Buffer.from(r.data, "base64"));
    }
  }
}

const NAME = { plain: "기본", lego: "레고", clean: "깔끔" };
const LOW = [];
console.log("프리셋      화면   카드 넘침 폰넘침 | 본문  제목  배지  날짜  태그  길찾기 단추  칩");
for (const r of rows) {
  const f = v => (v == null ? " --- " : String(v).padStart(5));
  console.log(
    (NAME[r.th] || r.th).padEnd(6) + (r.dark ? " 어두움" : " 밝음 ") +
    String(r.cards).padStart(5) + String(r.overflow).padStart(5) + String(r.폰넘침).padStart(6) + " |" +
    f(r.본문) + f(r.제목) + f(r.배지) + f(r.날짜) + f(r.태그) + f(r.길찾기) + f(r.단추) + f(r.유형칩));
  for (const k of ["본문", "제목", "배지", "날짜", "태그", "길찾기", "단추", "유형칩", "띠"]) {
    const v = r[k];
    if (v != null && v < 4.5) LOW.push(`${NAME[r.th]} ${r.dark ? "어두움" : "밝음"} · ${k} ${v}:1`);
  }
  if (r.overflow || r.폰넘침) LOW.push(`${NAME[r.th]} ${r.dark ? "어두움" : "밝음"} · 가로 넘침 ${r.overflow}/${r.폰넘침}px`);
  if (r.cards !== 5) LOW.push(`${NAME[r.th]} ${r.dark ? "어두움" : "밝음"} · 카드가 ${r.cards}장`);
}
/* ───────────────────────────────────────────────────────────
   색감 여섯 · 모양과 짝이 안 맞아도 읽히는가

   색감을 모양에서 뗐으므로 「메모지 모양 + 청사진 색」 같은 짝이 생긴다.
   여기서는 **가장 험한 모양** 하나에 색감 여섯을 차례로 입혀 본다.
   메모지가 험한 이유 · 덮개(--veil)가 투명이라 카드 바탕에 «유형 색» 이 그대로 드러난다.
   글자가 그 위에 얹히므로, 대비가 깨진다면 여기서 먼저 깨진다.
   ─────────────────────────────────────────────────────────── */
console.log("\n[현재 기본 색감 × 밝기]");
console.log("색감        화면   카드 넘침 | 본문  제목  배지  날짜  태그  길찾기 단추  칩");
const TNAME = { craft: "크래프트", sunny: "볕", sky: "하늘", forest: "숲", ink: "먹", blue: "청사진" };
for (const tn of TONES) {
  for (const dark of [false, true]) {
    await send("Emulation.clearDeviceMetricsOverride");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await ev(SEED);
    await ev(`localStorage.setItem('pkos.settings.v1', JSON.stringify({version:1, lookV2:true, lookV3:true, tone:"plain", theme:'lego', tone:'${tn}', mode:'${dark ? 'dark' : 'light'}', viewMode:'stream', folderMode:'perEntry'})); true`);
    await send("Page.reload", { ignoreCache: true });
    await wait(2400);
    await ev(`(() => { const c=document.querySelector('.composer'); if(c) c.style.display='none'; return true; })()`);
    const m = JSON.parse(await ev(`JSON.stringify(${MEASURE})`));
    const f = v => (v == null ? " --- " : String(v).padStart(5));
    console.log(
      (TNAME[tn] || tn).padEnd(7) + (dark ? " 어두움" : " 밝음 ") +
      String(m.cards).padStart(5) + String(m.overflow).padStart(5) + " |" +
      f(m.본문) + f(m.제목) + f(m.배지) + f(m.날짜) + f(m.태그) + f(m.길찾기) + f(m.단추) + f(m.유형칩));
    for (const k of ["본문", "제목", "배지", "날짜", "태그", "길찾기", "단추", "유형칩", "띠"]) {
      if (m[k] != null && m[k] < 4.5) LOW.push(`${TNAME[tn]} ${dark ? "어두움" : "밝음"} · ${k} ${m[k]}:1`);
    }
    if (m.overflow) LOW.push(`${TNAME[tn]} ${dark ? "어두움" : "밝음"} · 가로 넘침 ${m.overflow}px`);
    if (m.cards !== 5) LOW.push(`${TNAME[tn]} ${dark ? "어두움" : "밝음"} · 카드가 ${m.cards}장`);
  }
}

/* ───────────────────────────────────────────────────────────
   축이 서로 안 흔들리는가 · 밝기 · 글자 크기

   모양·밝기·글자 크기는 «따로 도는 축» 이다. 하나를 고쳐도 다른 것이 안 변해야 한다.
   여기서 보는 것 셋 · 
     ① 기기가 밝아도 「어둡게」 를 고르면 어두워지는가 (고른 것이 기기를 이기는가)
     ② 기기가 어두워도 「밝게」 를 고르면 밝아지는가
     ③ 글자를 키워도 폰에서 가로로 안 넘치는가
   ─────────────────────────────────────────────────────────── */
async function look(theme, mode, fontSize, deviceDark, phone) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: deviceDark ? "dark" : "light" }] });
  if (phone) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  else await send("Emulation.clearDeviceMetricsOverride");
  await ev(SEED);
  await ev(`localStorage.setItem('pkos.settings.v1', JSON.stringify({version:1, lookV2:true, lookV3:true, tone:"plain", theme:'${theme}', mode:'${mode}', fontSize:'${fontSize}', viewMode:'stream', folderMode:'perEntry'})); true`);
  await send("Page.reload", { ignoreCache: true });
  await wait(2400);
  return JSON.parse(await ev(`(() => {
    const cs = getComputedStyle(document.documentElement);
    const hex = cs.getPropertyValue('--bg').trim();
    const n = parseInt(hex.replace('#',''), 16);
    return JSON.stringify({
      밝기: Math.round((((n>>16)&255)*0.299 + ((n>>8)&255)*0.587 + (n&255)*0.114)),
      fs: cs.getPropertyValue('--fs').trim(),
      본문px: Math.round(parseFloat(getComputedStyle(document.body).fontSize)),
      넘침: document.documentElement.scrollWidth - document.documentElement.clientWidth
    });
  })()`));
}

console.log("\n[축이 서로 안 흔들리는가]");
console.log("프리셋      기기밝음+어둡게   기기어두움+밝게   폰·아주크게");
for (const th of THEMES) {
  const d = await look(th, "dark", "", false, false);     // ① 고른 어둠이 이기는가
  const l = await look(th, "light", "", true, false);     // ② 고른 밝음이 이기는가
  const h = await look(th, "", "huge", false, true);      // ③ 키워도 안 넘치는가
  const okD = d.밝기 < 90, okL = l.밝기 > 165, okH = h.넘침 === 0 && h.본문px >= 18;
  console.log(
    (NAME[th] || th).padEnd(8) +
    (okD ? "  OK " : " FAIL") + String(d.밝기).padStart(6) + "        " +
    (okL ? "  OK " : " FAIL") + String(l.밝기).padStart(6) + "        " +
    (okH ? "  OK " : " FAIL") + (" " + h.본문px + "px/넘침" + h.넘침).padStart(12));
  if (!okD) LOW.push(`${NAME[th]} · 「어둡게」 를 골랐는데 배경 밝기가 ${d.밝기}`);
  if (!okL) LOW.push(`${NAME[th]} · 「밝게」 를 골랐는데 배경 밝기가 ${l.밝기}`);
  if (!okH) LOW.push(`${NAME[th]} · 글자를 키우니 폰에서 ${h.넘침}px 넘침 (본문 ${h.본문px}px)`);
}

console.log("\n[걸리는 것]");
if (!LOW.length) console.log("  없음");
else LOW.forEach(x => console.log("  " + x));
console.log("\n자바스크립트 오류:", errs.length ? errs[0] : "없음");
p.kill(); process.exit(LOW.length ? 1 : 0);
