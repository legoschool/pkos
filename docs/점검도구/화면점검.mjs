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

/* ---------- 1. 첫 화면 ---------- */
const boot = await evaluate(`JSON.stringify({
  title: document.title,
  editor: !!document.getElementById('blocks'),
  banner: (document.getElementById('banner')||{}).textContent || '',
  addButtons: document.querySelectorAll('[data-add]').length
})`);
const b = JSON.parse(boot);
check("첫 화면이 그려진다", b.editor && b.addButtons > 0, `＋버튼 ${b.addButtons}개`);
check("자바스크립트 오류 없음", errors.length === 0, errors[0] || "");

/* ---------- 1-2. 모양은 하나 · 조용한 종이 ----------
   예전에는 처음 온 사람에게 «어떤 모양으로 쓸까요?» 를 물었다.
   모양이 하나가 되면서 물을 것이 없어졌다 · 창이 안 떠야 한다.
   ⚠️ 모양은 «업노트처럼» 으로 다시 잡았다. 강조색 판·레고 돌기·둥근 제목 글꼴을
      걷어내고, 흰 종이에 머리카락 테두리만 남겼다. 색면이 크면 화면 전체가
      그 색 이야기가 되어 정작 읽어야 할 글이 뒤로 밀린다. */
await wait(700);
const look = await evaluate(`(() => {
  const asked = Array.from(document.querySelectorAll('.card.modal')).some(x => (x.textContent||'').includes('어떤 모양으로'));
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    asked: asked,
    attr: document.documentElement.getAttribute('data-theme'),
    tone: document.documentElement.getAttribute('data-tone'),
    size: document.documentElement.getAttribute('data-size'),
    radius: cs.getPropertyValue('--radius').trim(),
    stud: cs.getPropertyValue('--stud').trim(),
    titleFont: cs.getPropertyValue('--font-title').trim()
  });
})()`);
const lk = JSON.parse(look);
check("모양을 묻는 창이 더는 없다", !lk.asked, lk.asked ? "아직 묻는다" : "안 묻는다");
check("묻지 않아도 한 모양으로 선다", lk.attr === "lego", String(lk.attr));
/* 돌기와 큰 모서리는 걷어냈다 · 돌아오면 안 된다 */
check("장식 돌기가 없다", lk.stud === "none", String(lk.stud));
check("모서리가 조용하다", parseFloat(lk.radius) <= 12, lk.radius);
/* ⚠️ 태어날 때의 색을 «깔끔»(흰 종이에 청록)으로 옮겼다 · 업노트가 서 있는 자리다.
   이미 색을 고른 사람의 설정은 안 건드린다 (settings.tone 이 이긴다). */
check("태어날 때의 색은 깔끔이다", lk.tone === "clean", String(lk.tone));
check("처음 오는 사람은 큰 글자로 시작한다", lk.size === "big", String(lk.size || "보통"));
/* 제목 글꼴도 본문과 같은 것으로 · 글꼴이 둘이면 화면이 시끄럽다 */
check("제목 글꼴이 본문과 같다", !/Jua|Gaegu/.test(lk.titleFont), lk.titleFont.slice(0, 30));
const headband = await evaluate(`(() => {
  const h = document.querySelector('header.top');
  const cs = getComputedStyle(h);
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  return JSON.stringify({ bg: cs.backgroundColor, brand: brand });
})()`);
const hb = JSON.parse(headband);
/* ⚠️ 머리띠는 이제 «강조색 판» 이 아니다. 종이색이라야 한다 ·
   글이 주인공이고 머리띠는 자리만 잡아 준다. */
check("머리띠가 조용한 판이다", !!hb.bg && hb.bg !== "rgba(0, 0, 0, 0)" && hb.bg !== hb.brand,
  `${hb.bg} (강조 ${hb.brand})`);


/* 기록 카드가 «유형 색» 을 물려받는지 · 프리셋의 핵심이다.
   색을 유형 키로 정하면 사용자가 만든 유형에 색이 없어지므로, 차례(자리)로 돌려 쓴다. */
const tinted = await evaluate(`(() => {
  const chips = Array.from(document.querySelectorAll('#typeChips .chip'));
  if (chips.length < 3) return 'NO_CHIPS';
  const v = chips.slice(0, 3).map(c => getComputedStyle(c).getPropertyValue('--c').trim());
  return JSON.stringify(v);
})()`);
const tn = /^NO_/.test(tinted) ? null : JSON.parse(tinted);
check("유형마다 다른 색이 붙는다", !!tn && new Set(tn).size >= 3, tn ? tn.join(" ") : String(tinted));

// 다시 기본으로 돌려 놓는다. 뒤따르는 점검이 «지금 화면» 기준으로 짜여 있다.
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.theme = 'base'; localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  document.documentElement.removeAttribute('data-theme');
  return true;
})()`);

/* ---------- 1-3. 녹음. 제목과 내용이 갈려 있는가 ----------
   전에는 받아 적은 글의 앞 60자가 «자료 제목» 이 되어 파일 이름에 통째로 박혔다.
   («2026-08-21_부기_협의회_아직 교사가 안 다듬어져서 요거 다듬어지고…_02.webm»)
   제목은 사람이 짧게 적는 칸이 따로 있어야 하고, 말한 내용은 글 블록이 맡아야 한다. */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);
const voiceUi = await evaluate(`(() => {
  // 녹음은 접힌 쪽에 있다 · 한 번 펴고 누른다
  const barV = document.getElementById('addbar');
  if (barV && !barV.classList.contains('open')) document.getElementById('btnAddMore').click();
  const b = Array.from(document.querySelectorAll('[data-add]')).find(x => (x.textContent||'').includes('녹음'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('녹음'));
  if (!m) return 'NO_MODAL';
  const labels = Array.from(m.querySelectorAll('.field > label')).map(e => e.textContent);
  return JSON.stringify({ labels: labels, inputs: m.querySelectorAll('.field input.inp').length });
})()`);
const vu = /^NO_/.test(voiceUi) ? null : JSON.parse(voiceUi);
check("녹음 창에 «제목» 칸이 따로 있다",
  !!vu && vu.labels.some(l => /제목/.test(l)) && vu.labels.some(l => /받아 적은 글/.test(l)) && vu.inputs >= 1,
  vu ? vu.labels.join(" / ") : String(voiceUi));

// 제목을 비운 채로 받아 적은 글만 넣어 본다. 그 글이 «자료 제목» 으로 새면 안 된다
const voiceSplit = await evaluate(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('녹음'));
  const ta = m.querySelector('textarea.inp');
  ta.value = '아직 교사가 안 다듬어져서 요거 다듬어지고 나면 이제 학생은 거기에 맞게 그냥 세팅만 하거든요';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const go = Array.from(m.querySelectorAll('.mfoot button')).find(b => /넣기|담기|넣습|확인|저장/.test(b.textContent||''));
  if (go) go.click();
  return go ? 'OK' : Array.from(m.querySelectorAll('.mfoot button')).map(b=>b.textContent).join('|');
})()`);
await wait(700);
const blocksNow = await evaluate(`(() => {
  const nodes = Array.from(document.querySelectorAll('#blocks .block'));
  const txt = nodes.map(n => (n.querySelector('.bkind')||{}).textContent || '').join(',');
  const caps = nodes.map(n => { const i = n.querySelector('input.inp'); return i ? i.value : ''; }).filter(Boolean);
  return JSON.stringify({ kinds: txt, caps: caps });
})()`);
const bn = JSON.parse(blocksNow);
check("받아 적은 글이 «자료 제목» 으로 새지 않는다",
  !bn.caps.some(c => /다듬어져서/.test(c)),
  bn.caps.length ? bn.caps.join(" | ") : "(제목 칸 비어 있음)");
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove());
  blocks = []; return true; })()`).catch(() => {});
await evaluate(`(() => {
  document.querySelectorAll('#blocks .block').forEach(n => {
    const x = Array.from(n.querySelectorAll('button')).find(b => /✕|×/.test(b.textContent||''));
    if (x) x.click();
  });
  return true;
})()`);
await wait(400);

/* ---------- 1-4. 폴더 정리 방식 · 고르는 목록이 그림을 가리지 않는가 ----------
   전에는 <select> 였다. 펼치면 그 아래 폴더 그림을 통째로 덮었다. 정작 봐야 할 것을 가렸다. */
await evaluate(`document.getElementById('btnSettings').click(); true`);
await wait(500);
await evaluate(`(() => {
  const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '저장 위치');
  if (t) t.click(); return true;
})()`);
await wait(600);
const modeUi = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.modecard'));
  return JSON.stringify({
    cards: cards.length,
    selects: document.querySelectorAll('.mbody select').length,
    trees: document.querySelectorAll('.modecard .ftree').length,
    icons: document.querySelectorAll('.modecard .ftree svg').length,
    browse: !!document.getElementById('btnMap')
  });
})()`);
const mu = JSON.parse(modeUi);
/* 다섯이었던 것을 둘로 줄였다. 고르는 자리에서 다섯을 견주면 무엇을 골라도
   «다른 넷이 나았을까» 가 남는다. 이 앱이 정말 묻는 것은 하나다 ·
   한 편을 한 폴더에 담을까, 말까. 옛 방식 셋은 쓰던 사람에게만 한 칸으로 보인다. */
check("정리 방식은 둘뿐이다", mu.cards === 2, `카드 ${mu.cards}개`);
check("고르는 목록(select)이 그림을 덮지 않는다", mu.selects === 0, `select ${mu.selects}개`);
check("방식마다 폴더 그림이 붙는다", mu.trees === 2 && mu.icons >= 6, `그림 ${mu.trees}개 · 아이콘 ${mu.icons}개`);
check("«폴더 구조» 로 가는 길이 있다", mu.browse === true);

// 눌러서 바꾸면 그 카드로 «고름» 이 옮겨가야 한다
const switched = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.modecard'));
  const target = cards.find(c => !c.classList.contains('on'));
  if (!target) return 'NO_TARGET';
  const name = target.querySelector('strong').textContent;
  target.click();
  const nowOn = document.querySelector('.modecard.on strong');
  return JSON.stringify({ picked: name, on: nowOn ? nowOn.textContent : '' });
})()`);
const sw = /^NO_/.test(switched) ? null : JSON.parse(switched);
check("눌러서 정리 방식을 바꿀 수 있다", !!sw && sw.picked === sw.on, sw ? `${sw.picked} → ${sw.on}` : String(switched));
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);

/* ---------- 2. 사진을 하나 넣는다 (파일 고르기 없이 직접 투입) ---------- */
// 잔무늬가 많은 200x120 PNG. 줄무늬로 하면 «칸 크기와 줄 간격이 맞아» 뭉갠 티가 안 나서
// 판정이 흐려진다. 매번 같은 그림이 나오도록 씨앗을 고정한 잡음을 쓴다.
const dropped = await evaluate(`(async () => {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 120;
  const x = c.getContext('2d');
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const im = x.createImageData(c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    im.data[i] = rnd() * 255; im.data[i+1] = rnd() * 255; im.data[i+2] = rnd() * 255; im.data[i+3] = 255;
  }
  x.putImageData(im, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], '시험사진.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const inp = document.getElementById('cropPickInput');   // 자르기 화면으로 들어가는 입구
  if (!inp) return 'NO_INPUT';
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 'DROPPED';
})()`);
check("사진 입력 경로가 살아 있다", dropped === "DROPPED", String(dropped));
await wait(1500);

/* ---------- 3. 자르기/모자이크 창이 뜨는가 ---------- */
const modal = await evaluate(`JSON.stringify({
  open: !!document.querySelector('.cropwrap'),
  modes: Array.from(document.querySelectorAll('.modebar button')).map(b => b.textContent),
  title: (document.querySelector('.modal .mhead h3')||{}).textContent || ''
})`);
const mo = JSON.parse(modal);
check("자르기 창이 뜬다", mo.open, mo.title);
check("모자이크 단추가 있다", mo.modes.some((t) => t.includes("모자이크")), mo.modes.join(" / "));

/* ---------- 4. 모자이크 모드로 바꾸고 영역을 가려 본다 ---------- */
if (mo.open) {
  await evaluate(`Array.from(document.querySelectorAll('.modebar button'))
    .find(b => b.textContent.includes('모자이크')).click(); true`);
  await wait(300);
  const masked = await evaluate(`JSON.stringify({
    hint: (document.querySelector('.crophint')||{}).textContent || '',
    primary: (document.querySelector('.mfoot .primary')||{}).textContent || '',
    head: (document.querySelector('.modal .mhead h3')||{}).textContent || ''
  })`);
  const ma = JSON.parse(masked);
  check("모자이크 모드로 바뀐다", ma.primary.includes("가리기"), ma.head);

  // 이미지 위에서 드래그 흉내 · 왼쪽 절반을 고른다
  const dragged = await evaluate(`(() => {
    const img = document.querySelector('.cropwrap img');
    const r = img.getBoundingClientRect();
    const wrap = document.querySelector('.cropwrap');
    function ev(type, x, y, target) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
    }
    ev('mousedown', r.left + 4, r.top + 4, wrap);
    ev('mousemove', r.left + r.width/2, r.top + r.height - 4, window);
    ev('mouseup', r.left + r.width/2, r.top + r.height - 4, window);
    const sel = document.querySelector('.cropsel');
    return JSON.stringify({ shown: sel.style.display !== 'none', size: (document.querySelector('.cropsize')||{}).textContent });
  })()`);
  const dr = JSON.parse(dragged);
  check("드래그로 영역이 잡힌다", dr.shown, dr.size || "");

  // 가리기 전 픽셀을 한 줄 떠 둔다 (나중에 «어디가 바뀌었나» 를 정확히 본다)
  await evaluate(`(async () => {
    const img = document.querySelector('.cropwrap img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    window.__before = Array.from(c.getContext('2d').getImageData(0, Math.floor(c.height/2), c.width, 1).data);
    window.__w = c.width;
    return true;
  })()`);
  const before = await evaluate(`document.querySelector('.cropwrap img').src.length`);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button'))
    .find(b => b.textContent.includes('이 부분 가리기')).click(); true`);
  await wait(600);
  const after = await evaluate(`JSON.stringify({
    len: document.querySelector('.cropwrap img').src.length,
    undo: !!Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('되돌리기') && b.style.display !== 'none')
  })`);
  const af = JSON.parse(after);
  check("가리기가 실제로 그림을 바꾼다", af.len !== before, `${before} → ${af.len} bytes`);
  check("되돌리기 단추가 나타난다", af.undo);

  // 가린 쪽 픽셀은 «바뀌어야» 하고, 안 가린 쪽은 «한 점도 안 바뀌어야» 한다
  const pixels = await evaluate(`(async () => {
    const img = document.querySelector('.cropwrap img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const now = c.getContext('2d').getImageData(0, Math.floor(c.height/2), c.width, 1).data;
    const was = window.__before;
    const half = Math.floor(c.width / 2);
    let changedLeft = 0, changedRight = 0;
    for (let x = 0; x < c.width; x++) {
      const i = x * 4;
      const diff = Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]);
      if (diff > 12) { if (x < half - 3) changedLeft++; else if (x > half + 3) changedRight++; }
    }
    return JSON.stringify({ changedLeft, changedRight, half });
  })()`);
  const px = JSON.parse(pixels);
  check("가린 쪽 픽셀이 실제로 뭉개진다", px.changedLeft > px.half * 0.3, `${px.changedLeft}px 바뀜`);
  check("안 가린 쪽은 원본 그대로다", px.changedRight === 0, `${px.changedRight}px 바뀜`);

  // 넣기까지 끝내 본다
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button'))
    .find(b => b.textContent.includes('전체 사용')).click(); true`);
  /* 사진 한 장을 블록으로 앉히는 데는 그림을 다시 그리는 시간이 든다.
     기다리는 시간을 900ms 로 못 박아 두었더니, 느린 판에서 가끔 «단추가 없다» 고
     빨개졌다. 다시 돌리면 초록이었다. 흔들리는 점검은 못 믿는 점검이라, 붙을 때까지 본다. */
  let placed = '{"blocks":0,"maskBtn":false}';
  for (let k = 0; k < 25; k++) {
    await wait(200);
    placed = await evaluate(`JSON.stringify({
      blocks: document.querySelectorAll('#blocks .block').length,
      maskBtn: !!Array.from(document.querySelectorAll('#blocks button')).find(b => b.textContent.includes('가리기'))
    })`);
    if (JSON.parse(placed).maskBtn) break;
  }
  const pl = JSON.parse(placed);
  check("사진 블록으로 들어간다", pl.blocks > 0, `블록 ${pl.blocks}개`);
  check("넣은 사진에도 «가리기» 단추가 붙는다", pl.maskBtn);
}

/* ---------- 4-1-2. 사진 가리기 (여러 장 한 번에) ----------
   사진 두 장을 더 넣어 놓고, 원 도장이 진짜로 뭉개는지 픽셀로 본다. */
await evaluate(`(async () => {
  const mk = (seed) => new Promise(async res => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 180;
    const x = c.getContext('2d');
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const im = x.createImageData(c.width, c.height);
    for (let i = 0; i < im.data.length; i += 4) {
      im.data[i] = rnd()*255; im.data[i+1] = rnd()*255; im.data[i+2] = rnd()*255; im.data[i+3] = 255;
    }
    x.putImageData(im, 0, 0);
    c.toBlob(b => res(new File([b], '단체사진' + seed + '.png', { type: 'image/png' })), 'image/png');
  });
  const dt = new DataTransfer();
  dt.items.add(await mk(7)); dt.items.add(await mk(21));
  const inp = document.getElementById('imgInput');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await wait(1200);

const maskBar = JSON.parse(await evaluate(`JSON.stringify({
  shown: !document.getElementById('maskBar').classList.contains('hidden'),
  hint: (document.getElementById('maskBarHint')||{}).textContent || ''
})`));
check("사진이 있으면 «사진 가리기» 줄이 나온다", maskBar.shown, maskBar.hint);

const studio = await evaluate(`(() => {
  document.getElementById('btnMaskAll').click();
  return document.querySelector('.maskpad') ? 'OPEN' : 'NO_PAD';
})()`);
check("가리기 화면이 열린다", studio === "OPEN", String(studio));

if (studio === "OPEN") {
  await wait(700);
  const setup = JSON.parse(await evaluate(`JSON.stringify({
    thumbs: document.querySelectorAll('.maskthumb').length,
    sizes: Array.from(document.querySelectorAll('.modebar:not(.grainbar) button')).map(b => b.textContent.trim()),
    grains: Array.from(document.querySelectorAll('.grainbar button')).map(b => b.textContent.trim()),
    canvasW: document.querySelector('.maskpad').width
  })`));
  check("이 기록의 사진이 전부 늘어선다", setup.thumbs >= 3, `${setup.thumbs}장`);
  check("원 크기를 고를 수 있다", setup.sizes.length === 4, setup.sizes.join(" / "));
  // 「픽셀이 너무 크다」는 말을 이 자리에서 풀 수 있어야 한다
  check("모자이크 칸 굵기를 고를 수 있다", setup.grains.length === 3, setup.grains.join(" / "));

  // 가운데를 한 번 «톡» 누른다
  const stamped = JSON.parse(await evaluate(`(() => {
    const cv = document.querySelector('.maskpad');
    cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
    const x = cv.getContext('2d');
    const was = Array.from(x.getImageData(0, 0, cv.width, cv.height).data);
    const r = cv.getBoundingClientRect();
    const ev = (t, cx, cy) => cv.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      isPrimary: true, clientX: cx, clientY: cy }));
    ev('pointerdown', r.left + r.width/2, r.top + r.height/2);
    ev('pointerup', r.left + r.width/2, r.top + r.height/2);
    const now = x.getImageData(0, 0, cv.width, cv.height).data;
    // 가운데(원 안)와 모서리(원 밖)를 나눠 센다
    let inside = 0, outside = 0;
    const cxp = cv.width/2, cyp = cv.height/2;
    const rad = Math.max(cv.width, cv.height) * 0.06;
    for (let y = 0; y < cv.height; y += 2) for (let px = 0; px < cv.width; px += 2) {
      const i = (y*cv.width + px)*4;
      const d = Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]);
      if (d <= 12) continue;
      if (Math.hypot(px-cxp, y-cyp) <= rad * 1.15) inside++; else outside++;
    }
    return JSON.stringify({ inside, outside,
      badge: (document.querySelector('.maskdone')||{}).textContent || '' });
  })()`));
  check("누른 자리가 동그랗게 뭉개진다", stamped.inside > 60, `${stamped.inside}px 바뀜`);
  check("원 밖은 한 점도 안 건드린다", stamped.outside === 0, `${stamped.outside}px 바뀜`);
  check("가린 사진에 ✓ 가 붙는다", /✓/.test(stamped.badge), stamped.badge);

  /* 가장자리 얼굴 · 왼쪽 위 모서리에 찍어 본다.
     원이 사진 밖으로 넘칠 때도 «그 자리는 반드시 지워져야» 한다.
     (넘치는 네모를 잘라내는 계산이 틀리면 모서리가 빈 채로 남을 수 있다) */
  const corner = JSON.parse(await evaluate(`(() => {
    const cv = document.querySelector('.maskpad');
    const x = cv.getContext('2d');
    const was = Array.from(x.getImageData(0, 0, cv.width, cv.height).data);
    const r = cv.getBoundingClientRect();
    ['pointerdown','pointerup'].forEach(t => cv.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch',
      isPrimary: true, clientX: r.left + 2, clientY: r.top + 2 })));
    const now = x.getImageData(0, 0, cv.width, cv.height).data;
    // 모서리 바로 안쪽(0,0 근처)이 실제로 바뀌었는가
    let nearCorner = 0;
    for (let y = 0; y < 12; y++) for (let px = 0; px < 12; px++) {
      const i = (y*cv.width + px)*4;
      if (Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]) > 12) nearCorner++;
    }
    return JSON.stringify({ nearCorner });
  })()`));
  check("모서리에 찍어도 그 자리가 지워진다", corner.nearCorner > 60, `모서리 ${corner.nearCorner}/144px 바뀜`);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('한 번 되돌리기')).click(); true`);

  // 다음 사진으로 넘어갔다 돌아와도 남아 있는가
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다음')).click(); true`);
  await wait(600);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('이전')).click(); true`);
  await wait(600);
  const kept = JSON.parse(await evaluate(`JSON.stringify({
    badges: document.querySelectorAll('.maskdone').length,
    doneLabel: (Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다 됐습니다'))||{}).textContent || ''
  })`));
  check("사진을 넘나들어도 가린 것이 남는다", kept.badges >= 1, `✓ ${kept.badges}장`);
  check("몇 장 고쳤는지 단추에 보인다", /\(\d+장\)/.test(kept.doneLabel), kept.doneLabel);

  const applied = await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다 됐습니다')).click();
    return true;
  })()`);
  await wait(1200);
  const back = JSON.parse(await evaluate(`JSON.stringify({
    modalGone: !document.querySelector('.maskpad'),
    imgs: document.querySelectorAll('#blocks img.thumb').length
  })`));
  check("«다 됐습니다» 를 누르면 사진에 반영된다", back.modalGone && back.imgs > 0, `사진 ${back.imgs}장`);
}

/* ---------- 4-1-3. 파일 이름에 태그·자료제목이 들어가는가 ---------- */
const naming = JSON.parse(await evaluate(`(() => {
  document.getElementById('title').value = '물의 상태변화 수업';
  document.getElementById('tags').value = '수업설계, 3학년';
  document.getElementById('tags').dispatchEvent(new Event('input', {bubbles:true}));
  const cap = Array.from(document.querySelectorAll('#blocks input.inp'))
    .find(i => /제목|캡션/.test(i.placeholder || ''));
  if (!cap) return JSON.stringify({ err: 'NO_CAPTION_FIELD' });
  const before = (document.querySelector('#blocks .savedname')||{}).textContent || '';
  cap.value = '칠판 정리';
  cap.dispatchEvent(new Event('input', { bubbles: true }));
  const after = (document.querySelector('#blocks .savedname')||{}).textContent || '';
  return JSON.stringify({ placeholder: cap.placeholder, before, after });
})()`));
check("사진 칸이 «제목»이라고 말해 준다",
  /파일 이름에 들어갑니다/.test(naming.placeholder || ""), naming.placeholder || naming.err || "");
check("태그가 파일 이름에 들어간다", /수업설계/.test(naming.after || ""), naming.after || "");
check("적은 제목이 파일 이름에 들어간다",
  /칠판 정리/.test(naming.after || "") && naming.after !== naming.before, naming.after || "");

/* ---------- 4-1-4. 밖에서 넣은 파일 이름 정리 ---------- */
const tidy = await evaluate(`(() => {
  const b = document.getElementById('btnMap');
  if (!b) return 'NO_MAP';
  b.click();
  const t = Array.from(document.querySelectorAll('.mfoot button'))
    .find(x => x.textContent.includes('이름 정리'));
  if (!t) return 'NO_BUTTON';
  t.click();
  const toast = document.getElementById('toast');
  const msg = (toast && toast.classList.contains('show')) ? toast.textContent : '';
  document.querySelectorAll('.modal-bg').forEach(e => e.remove());
  return msg || (document.querySelector('.renamebox') ? 'OPENED' : 'NOTHING');
})()`);
check("폴더 구조에 «파일 이름 정리»가 있다", tidy !== "NO_MAP" && tidy !== "NO_BUTTON", String(tidy));
check("연결 전에는 막히고 이유를 말해 준다", /연결/.test(String(tidy)), String(tidy));

/* ---------- 4-2. 손 메모 ---------- */
const drawOpen = await evaluate(`(() => {
  const bar0 = document.getElementById('addbar');
  if (bar0 && !bar0.classList.contains('open')) document.getElementById('btnAddMore').click();
  const b = document.querySelector('[data-add="draw"]');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.drawpad') ? 'OPEN' : 'NO_PAD';
})()`);
check("«＋ 손 메모» 판이 열린다", drawOpen === "OPEN", String(drawOpen));

if (drawOpen === "OPEN") {
  await wait(300);
  const drew = await evaluate(`(() => {
    const cv = document.querySelector('.drawpad');
    const r = cv.getBoundingClientRect();
    function ev(type, x, y, extra) {
      cv.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen',
        isPrimary: true, pressure: 0.7, clientX: x, clientY: y
      }, extra || {})));
    }
    cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
    ev('pointerdown', r.left + 30, r.top + 30);
    for (let i = 1; i <= 25; i++) ev('pointermove', r.left + 30 + i * 8, r.top + 30 + Math.sin(i/3) * 25);
    ev('pointerup', r.left + 230, r.top + 40);
    // 흰 종이 위에 실제로 잉크가 남았는지 센다
    const x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) ink++;
    const undoBtn = Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('되돌리기'));
    return JSON.stringify({ ink, undoOn: undoBtn ? !undoBtn.disabled : false });
  })()`);
  const dw = JSON.parse(drew);
  // 판 크기는 화면에 따라 달라진다. «획 하나가 남을 만큼» 만 보면 된다.
  check("펜으로 그은 획이 남는다", dw.ink > 200, `잉크 ${dw.ink}px`);
  check("되돌리기가 켜진다", dw.undoOn);

  const saved = await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('넣기')).click();
    return true;
  })()`);
  await wait(1200);
  const inBlocks = await evaluate(`JSON.stringify({
    names: Array.from(document.querySelectorAll('#blocks .origname')).map(e => e.textContent).join(' | '),
    imgs: document.querySelectorAll('#blocks img.thumb').length
  })`);
  const ib = JSON.parse(inBlocks);
  check("손 메모가 사진 블록으로 들어간다", ib.imgs > 0 && ib.names.includes("손메모"), ib.names.slice(0, 60));
}

/* ---------- 4-3. 녹음 ---------- */
const voiceOpen = await evaluate(`(() => {
  const bar1 = document.getElementById('addbar');
  if (bar1 && !bar1.classList.contains('open')) document.getElementById('btnAddMore').click();
  const b = document.querySelector('[data-add="voice"]');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.voiceclock') ? 'OPEN' : 'NO_PANEL';
})()`);
check("«＋ 녹음» 판이 열린다", voiceOpen === "OPEN", String(voiceOpen));

if (voiceOpen === "OPEN") {
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('녹음 시작')).click(); true`);
  /* 가짜 마이크의 소리 막대는 뜨는 때가 판마다 다르다. 흔들리는 점검은 못 믿는 점검이라
     «움직일 때까지» 본다. 시계·상태도 같은 눈으로 함께 걷는다. */
  let rc = { clock: '0:00', meter: 0, status: '' };
  for (let vk = 0; vk < 20; vk++) {
    await wait(400);
    rc = JSON.parse(await evaluate(`JSON.stringify({
      clock: (document.querySelector('.voiceclock')||{}).textContent,
      meter: parseFloat((document.querySelector('.voicebar')||{}).style.width) || 0,
      status: (document.querySelector('.mfoot .desc')||{}).textContent || ''
    })`));
    if (rc.meter > 0 && rc.clock !== '0:00' && rc.status.includes('녹음 중')) break;
  }
  check("시계가 돈다", rc.clock !== "0:00", rc.clock);
  check("녹음 중 표시가 뜬다", rc.status.includes("녹음 중"), rc.status);
  check("소리 크기 막대가 움직인다", rc.meter > 0, `${rc.meter}%`);

  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('멈추기')).click(); true`);
  await wait(1200);
  const done = await evaluate(`JSON.stringify({
    status: (document.querySelector('.mfoot .desc')||{}).textContent || '',
    player: (document.querySelector('.mbody audio')||{}).style ? document.querySelector('.mbody audio').style.display !== 'none' : false,
    put: !!Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('넣기') && b.style.display !== 'none')
  })`);
  const dn = JSON.parse(done);
  check("멈추면 소리가 실제로 담긴다", /\d+(\.\d+)?\s*(B|KB|MB)/i.test(dn.status), dn.status);
  check("바로 들어볼 수 있다", dn.player);

  await evaluate(`(() => {
    document.querySelector('.mbody textarea').value = '증발과 끓음의 차이를 다음 시간에 실험으로 확인하기';
    document.querySelector('.mbody textarea').dispatchEvent(new Event('input', {bubbles:true}));
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('이 녹음 넣기')).click();
    return true;
  })()`);
  await wait(900);
  const vb = JSON.parse(await evaluate(`JSON.stringify({
    audios: document.querySelectorAll('#blocks audio').length,
    names: Array.from(document.querySelectorAll('#blocks .origname')).map(e => e.textContent).join(' | '),
    texts: Array.from(document.querySelectorAll('#blocks textarea')).map(e => e.value).join(' ')
  })`));
  check("녹음이 블록으로 들어간다", vb.audios > 0 && vb.names.includes("녹음_"), vb.names.slice(-60));
  check("받아 적은 글도 함께 들어간다", vb.texts.includes("증발과 끓음"), "");
}

/* ---------- 4-4. 밖에서 담아 온 녹음 파일 ----------
   폰 녹음기·회의 녹음기로 담아 온 것이 대부분이다. 그것도 이 창에서 받아 적을 수 있어야
   «녹음 = 이 창» 이 된다. 안 그러면 파일은 파일대로 따로 붙이게 된다. */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove());
  document.getElementById('blocks').innerHTML = ''; return true; })()`);
const file = JSON.parse(await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('[data-add]')).find(x => (x.textContent||'').includes('녹음'));
  if (!b) return JSON.stringify({ err: 'NO_BUTTON' });
  b.click();
  const m = document.querySelector('.modal-bg .card.modal');
  if (!m) return JSON.stringify({ err: 'NO_MODAL' });
  const seen = () => Array.from(m.querySelectorAll('.mfoot button'))
    .filter(x => x.style.display !== 'none').map(x => x.textContent.trim());
  const before = seen();
  const inp = m.querySelector('input[type=file][accept="audio/*"]');
  if (!inp) return JSON.stringify({ err: 'NO_FILE_INPUT', before: before });
  // 아주 작은 wav 하나를 «불러온 것처럼» 흉내 낸다
  const hdr = new Uint8Array([82,73,70,70,36,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,
                              1,0,1,0,68,172,0,0,136,88,1,0,2,0,16,0,100,97,116,97,0,0,0,0]);
  const dt = new DataTransfer();
  dt.items.add(new File([hdr], '회의녹음 8.23.wav', { type: 'audio/wav' }));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  const after = seen();
  const ta = m.querySelector('textarea');
  ta.value = '협의회에서 나온 이야기';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const put = Array.from(m.querySelectorAll('.mfoot button')).find(x => x.textContent.includes('이 녹음 넣기'));
  if (put) put.click();
  return JSON.stringify({
    before: before, after: after,
    names: Array.from(document.querySelectorAll('#blocks .origname')).map(e => e.textContent).join(' | '),
    texts: Array.from(document.querySelectorAll('#blocks textarea')).map(e => e.value).join(' ')
  });
})()`));
check("녹음 창에 길이 둘이다 (지금 말하기 · 파일 불러오기)",
  !file.err && (file.before || []).some(t => t.includes('녹음 시작')) && (file.before || []).some(t => t.includes('파일 불러오기')),
  file.err || (file.before || []).join(" / "));
check("파일을 불러오면 «넣기» 와 «틀어 놓고 받아 적기» 가 선다",
  (file.after || []).some(t => t.includes('넣기')) && (file.after || []).some(t => t.includes('받아 적기')),
  (file.after || []).join(" / "));
/* ⚠️ 불러온 파일은 «그 이름» 을 지켜야 한다. 「녹음_날짜」 로 갈아 끼우면
   폰에서 무슨 회의였는지 적어 둔 이름이 사라진다. */
check("불러온 파일은 그 이름을 지킨다", (file.names || "").includes("회의녹음 8.23.wav"),
  (file.names || "").slice(0, 70));
check("불러온 파일도 받아 적은 글과 함께 들어간다", (file.texts || "").includes("협의회에서 나온 이야기"), "");

/* ---------- 5. 설정 → 웹 캡처 칸 ---------- */
await evaluate(`document.getElementById('blocks').innerHTML=''; true`);
const capTab = await evaluate(`(() => {
  const btn = Array.from(document.querySelectorAll('header button, .top button'))
    .find(b => (b.textContent||'').includes('설정'));
  if (btn) btn.click();
  return !!btn;
})()`);
await wait(400);
const capUi = await evaluate(`(() => {
  const tab = Array.from(document.querySelectorAll('.tabs .tab')).find(t => t.textContent.includes('웹 캡처'));
  if (!tab) return JSON.stringify({ found: false });
  tab.click();
  const a = document.querySelector('.mbody a.btn');
  return JSON.stringify({
    found: true,
    href: a ? a.href.slice(0, 60) : '',
    hasAppUrl: a ? a.href.includes(location.origin + location.pathname) : false,
    mentionsShare: (document.querySelector('.mbody')||{}).textContent.includes('공유')
  });
})()`);
const cu = JSON.parse(capUi);
/* ⚠️ 「웹 캡처」 칸은 뺐다. 설명이 길어 «무엇을 하라는 것인지» 가 안 잡혔다.
   그래서 여기서는 «없어야 한다» 를 본다. 다시 생기면 그때 이 줄을 뒤집으면 된다.
   폰의 공유 시트로 받는 길은 manifest 가 담당하므로 그대로 살아 있다 (아래 6번에서 본다). */
check("설정에서 «웹 캡처» 칸을 뺐다 (설정 화면)", !cu.found, cu.found ? "아직 있다" : "없음");

/* ---------- 6. 웹 캡처가 실제로 블록이 되는가 ----------
   ⚠️ 앞 시험들이 제목 칸을 채워 놓았다. 웹 캡처는 «제목이 비어 있을 때만» 채우므로
      먼저 쓰다 만 것을 비워야 이 시험이 제 뜻대로 돌아간다. */
await evaluate(`(() => {
  localStorage.removeItem('pkos.draft.v1');
  const t = document.getElementById('title'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', {bubbles:true})); }
  return true;
})()`);
await wait(300);
const payload = encodeURIComponent(JSON.stringify({
  title: "물의 상태변화 정리",
  url: "https://example.org/science/water",
  text: "얼음이 녹는 동안에는 온도가 오르지 않는다.",
}));
await send("Page.navigate", { url: URL_ + "?fresh=1#capture=" + payload });
await wait(2500);
const captured = await evaluate(`JSON.stringify({
  title: (document.getElementById('title')||{}).value || '',
  blocks: document.querySelectorAll('#blocks .block').length,
  text: ((document.getElementById('blocks')||{}).textContent || '') +
        Array.from(document.querySelectorAll('#blocks input, #blocks textarea')).map(e => e.value).join(' '),
  hashGone: !location.hash
})`);
const cp2 = JSON.parse(captured);
check("웹 캡처가 제목을 채운다", cp2.title === "물의 상태변화 정리", cp2.title);
check("주소와 뽑아 둔 글이 블록이 된다", cp2.blocks >= 2, `블록 ${cp2.blocks}개`);
check("가져온 주소가 들어 있다", cp2.text.includes("example.org"), "");
check("주소창이 깨끗해진다", cp2.hashGone);

/* ---------- 7. 안드로이드 공유 시트 경로 (서비스 워커) ---------- */
const swReady = await evaluate(`navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)`);
check("서비스 워커가 살아 있다", swReady === true, String(swReady));

if (swReady) {
  const shared = await evaluate(`(async () => {
    const fd = new FormData();
    fd.append('title', '3학년 과학 수업 자료');
    fd.append('text', '증발과 끓음의 차이');
    fd.append('url', 'https://example.org/lesson/evaporation');
    const c = document.createElement('canvas'); c.width = 40; c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    fd.append('files', new File([blob], '칠판사진.png', { type: 'image/png' }));
    await fetch('./share', { method: 'POST', body: fd });
    const cache = await caches.open('pkos-share-inbox');
    const meta = await cache.match('/__share__/meta');
    const file = await cache.match('/__share__/file0');
    return JSON.stringify({
      meta: meta ? await meta.json() : null,
      fileBytes: file ? (await file.blob()).size : 0
    });
  })()`);
  const sh = JSON.parse(shared);
  check("공유 시트가 보낸 것을 워커가 받는다", !!sh.meta && sh.meta.url.includes("evaporation"),
    sh.meta ? sh.meta.title : "받지 못함");
  check("공유된 사진도 함께 넘어온다", sh.fileBytes > 0, `${sh.fileBytes} bytes`);

  // 화면 쪽에서 실제로 꺼내 블록이 되는지 · ?share=1 로 다시 들어간다
  await send("Page.navigate", { url: URL_ + "?share=1" });
  await wait(3000);
  const intake = await evaluate(`JSON.stringify({
    all: ((document.getElementById('blocks')||{}).textContent || '') +
         Array.from(document.querySelectorAll('#blocks input, #blocks textarea')).map(e => e.value).join(' '),
    imgs: document.querySelectorAll('#blocks img.thumb').length,
    clean: location.search === ''
  })`);
  const it = JSON.parse(intake);
  check("공유한 주소가 블록으로 들어온다", it.all.includes("evaporation"), "");
  check("공유한 사진이 첨부로 들어온다", it.imgs > 0, `사진 ${it.imgs}장`);
  check("주소창의 ?share=1 이 지워진다", it.clean);
}

/* ---------- 8. 폴더 지도 ---------- */
await evaluate(`(() => {
  const mk = (i, type, tags) => ({
    id: 'e' + i, type, title: '기록 ' + i, tags, blocks: [], relations: [],
    pinned: false, createdAt: '2026-0' + (1 + i % 8) + '-10T09:00:00.000Z',
    updatedAt: '2026-0' + (1 + i % 8) + '-10T09:00:00.000Z'
  });
  const list = [];
  for (let i = 0; i < 12; i++) list.push(mk(i, 'experience', ['수업설계', '3학년']));
  for (let i = 12; i < 19; i++) list.push(mk(i, 'knowledge', ['평가']));
  for (let i = 19; i < 22; i++) list.push(mk(i, 'idea', ['연수', '수업설계']));
  list.push(mk(99, 'experience', []));
  localStorage.setItem('pkos.entries.v2', JSON.stringify(list));
  localStorage.removeItem('pkos.draft.v1');
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
// 태그가 곧 폴더인 상태로 맞춰 둔다. 트리가 태그별로 갈라지는지 보려고
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.folderMode = 'tag';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);

const treeOpen = await evaluate(`(() => {
  const b = document.getElementById('btnMap');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.treebox') ? 'OPEN' : 'NO_BOX';
})()`);
check("«🗂 폴더 구조» 가 열린다", treeOpen === "OPEN", String(treeOpen));

if (treeOpen === "OPEN") {
  await wait(400);
  const tr = JSON.parse(await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.trow'));
    return JSON.stringify({
      rows: rows.length,
      folders: rows.filter(r => r.classList.contains('tfolder')).map(r => r.querySelector('.tname').textContent),
      indents: rows.map(r => parseFloat(r.style.paddingLeft)),
      firstIsRoot: rows[0] && rows[0].classList.contains('tfolder'),
      openFolders: rows.filter(r => r.classList.contains('tfolder') &&
                                    r.querySelector('.tcaret').textContent === '▾').length,
      hasMd: rows.some(r => /\\.md$/.test(r.querySelector('.tname').textContent))
    });
  })()`));
  check("뿌리 폴더가 맨 위에 온다", tr.firstIsRoot, tr.folders[0] || "");
  check("태그마다 폴더가 갈라진다", tr.folders.some(f => f.startsWith("수업설계")) && tr.folders.some(f => f.startsWith("평가")),
    tr.folders.slice(0, 6).join(" "));
  /* 처음 열면 «뿌리만» 펴져 있어야 한다.
     펴 둔 채로 열면 폴더가 몇 개만 되어도 한 화면에 안 들어와, 무엇이 있는지 도리어 안 보인다. */
  check("처음 열면 그 아래는 접혀 있다", !tr.hasMd && tr.openFolders === 1,
    `펴진 폴더 ${tr.openFolders}개 · .md ${tr.hasMd ? "보임" : "안 보임"}`);

  // 펴 놓고 안을 본다
  const tr2 = JSON.parse(await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent === '모두 펴기').click();
    const rows = Array.from(document.querySelectorAll('.trow'));
    return JSON.stringify({
      indents: rows.map(r => parseFloat(r.style.paddingLeft)),
      hasMd: rows.some(r => /\\.md$/.test(r.querySelector('.tname').textContent))
    });
  })()`));
  check("아래로 갈수록 안으로 들어간다", Math.max(...tr2.indents) > Math.min(...tr2.indents), `들여쓰기 ${Math.min(...tr2.indents)}~${Math.max(...tr2.indents)}px`);
  check(".md 파일이 폴더 안에 보인다", tr2.hasMd);

  // 접었다 폈다
  const toggled = JSON.parse(await evaluate(`(() => {
    const before = document.querySelectorAll('.trow').length;
    const f = Array.from(document.querySelectorAll('.trow.tfolder'))
      .find(r => r.querySelector('.tname').textContent.startsWith('수업설계'));
    if (!f) return JSON.stringify({ err: 'NO_FOLDER' });
    f.click();
    const folded = document.querySelectorAll('.trow').length;
    const f2 = Array.from(document.querySelectorAll('.trow.tfolder'))
      .find(r => r.querySelector('.tname').textContent.startsWith('수업설계'));
    f2.click();
    const back = document.querySelectorAll('.trow').length;
    return JSON.stringify({ before, folded, back });
  })()`));
  check("폴더를 접으면 줄이 줄어든다", toggled.folded < toggled.before, `${toggled.before} → ${toggled.folded}줄`);
  check("다시 펴면 그대로 돌아온다", toggled.back === toggled.before, `${toggled.folded} → ${toggled.back}줄`);

  const allBtns = JSON.parse(await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent === '모두 접기').click();
    const collapsed = document.querySelectorAll('.trow').length;
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent === '모두 펴기').click();
    const expanded = document.querySelectorAll('.trow').length;
    return JSON.stringify({ collapsed, expanded });
  })()`));
  check("«모두 접기» 는 뿌리만 남긴다", allBtns.collapsed < 15, `${allBtns.collapsed}줄`);
  check("«모두 펴기» 는 전부 펼친다", allBtns.expanded > allBtns.collapsed * 3, `${allBtns.expanded}줄`);

  // .md 를 누르면 그 기록이 열린다
  const opened = await evaluate(`(() => {
    const r = Array.from(document.querySelectorAll('.trow'))
      .find(r => /\\.md$/.test(r.querySelector('.tname').textContent));
    if (!r) return 'NO_MD';
    r.click();
    return 'CLICKED';
  })()`);
  await wait(700);
  const viewer = await evaluate(`!!document.querySelector('.viewer')`);
  check(".md 를 누르면 그 기록이 열린다", opened === "CLICKED" && viewer === true, String(opened));
  await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove(); document.body.style.overflow=''; return true; })()`);
}

/* ---------- 8-2. 공유 단추 ----------
   실제로 권한을 바꾸는 것은 로그인이 필요해 여기서 못 합니다.
   여기서 보는 것은 «단추가 있고, 눌러도 터지지 않고, 연결 안 됐을 때 제대로 막히는가». */
await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove();
  const bg = document.querySelector('.modal-bg'); if (bg) bg.remove();
  document.body.style.overflow = ''; return true; })()`);
/* ⚠️ 카드에 있던 「전체 보기」 단추는 걷어냈다 · 이제 «제목을 누르면» 열린다.
   가장 많이 하는 일이 가장 가까운 자리에 있어야 한다. 점검도 그 길로 들어간다. */
/* ⚠️ 3단에서는 제목을 누르면 «오른쪽 칸에서 열린다» · 전체 보기 창은 ⋯ 안에 있다 */
const viewerBtns = await evaluate(`(() => {
  const card = document.querySelector('.card.entry');
  if (!card) return 'NO_ENTRY';
  card.querySelector('.dots').click();
  const b = Array.from(document.querySelectorAll('.menupop button')).find(x => /전체 보기/.test(x.textContent));
  if (!b) return 'NO_ENTRY';
  b.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  const top = document.querySelector('.viewer .vtop');
  if (!top) return 'NO_VIEWER';
  return Array.from(top.querySelectorAll('button, a')).map(e => e.textContent).join(' | ');
})()`);
check("전체 보기에 «링크로 공유» 가 있다", String(viewerBtns).includes("링크로 공유"), String(viewerBtns).slice(0, 70));

const guarded = await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(b => b.textContent.includes('공유'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const t = document.getElementById('toast');
  return (t && t.classList.contains('show')) ? t.textContent : (document.querySelector('.mbody') ? 'MODAL' : 'NOTHING');
})()`);
check("연결 전에는 공유가 막히고 이유를 말해 준다", /연결|저장/.test(String(guarded)), String(guarded));
await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove();
  document.body.style.overflow = ''; return true; })()`);

/* ---------- 9. 엮어내기 · 창이 안 깨지고, 뽑은 것이 고른 모양을 따라가는가 ---------- */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
// 고른 프리셋이 «뽑아낸 파일» 까지 따라오는지 보려면 기본이 아닌 것으로 골라 둬야 한다
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.theme = 'note';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.reload", { ignoreCache: true });
await wait(2500);

const compiled = JSON.parse(await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('엮어내기'));
  if (!b) return JSON.stringify({ err: 'NO_BUTTON' });
  b.click();
  const m = document.querySelector('.modal-bg .card.modal');
  if (!m) return JSON.stringify({ err: 'NO_MODAL' });
  const foot = m.querySelector('.mfoot').getBoundingClientRect();
  const body = m.querySelector('.mbody').getBoundingClientRect();
  return JSON.stringify({
    overlap: Math.round(body.bottom - foot.top),      // 0 이하라야 한다
    outside: Math.round(foot.bottom - window.innerHeight)
  });
})()`));
/* ⚠️ 바닥줄이 목록 위에 겹쳐 보이던 자리다. flex 안에서 스크롤 되는 칸에
   min-height:0 이 없으면 몸통이 «내용만큼» 버텨 바닥줄을 창 밖으로 밀어낸다. */
check("엮어내기 창의 바닥줄이 목록을 안 가린다", !compiled.err && compiled.overlap <= 0,
  compiled.err || `겹침 ${compiled.overlap}px`);
check("엮어내기 창이 화면 안에 들어온다", !compiled.err && compiled.outside <= 0,
  compiled.err || `화면 밖 ${compiled.outside}px`);

const book = JSON.parse(await evaluate(`(async () => {
  let got = null;
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { got = b; return real(b); };
  const btn = Array.from(document.querySelectorAll('.card.modal .mfoot button')).find(x => (x.textContent||'').includes('.html'));
  if (!btn) { URL.createObjectURL = real; return JSON.stringify({ err: 'NO_HTML_BUTTON' }); }
  btn.click();
  await new Promise(r => setTimeout(r, 600));
  URL.createObjectURL = real;
  if (!got) return JSON.stringify({ err: 'NO_BLOB' });
  const t = await got.text();
  return JSON.stringify({
    theme: /data-theme="note"/.test(t),
    font: /Gaegu/.test(t),
    token: /--panel:#FFFCF5/.test(t),
    leak: /EduCreator|>홈</.test(t)
  });
})()`));
check("뽑아낸 .html 이 고른 모양을 따라간다", !book.err && book.theme && book.token,
  book.err || `data-theme ${book.theme ? "있음" : "없음"} · 토큰 ${book.token ? "있음" : "없음"}`);
check("프리셋 글꼴까지 함께 불러온다", !!book.font, book.font ? "Gaegu" : "글꼴 링크 없음");
check("뽑아낸 파일에 군더더기 머리줄이 없다", !book.leak, book.leak ? "무언가 끼어 있다" : "깨끗함");
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);

/* ---------- 10. 설정 · 「웹 캡처」 를 빼고, 관리자용은 접어 두었는가 ---------- */
const setTabs = JSON.parse(await evaluate(`(() => {
  document.getElementById('btnSettings').click();
  const tabs = Array.from(document.querySelectorAll('.tabs .tab')).map(t => t.textContent);
  const adv = Array.from(document.querySelectorAll('.tabs .tab')).find(t => t.textContent === '고급');
  if (adv) adv.click();
  const toggle = Array.from(document.querySelectorAll('.mbody button')).find(b => (b.textContent||'').includes('사본을 지은 사람용'));
  const box = toggle ? toggle.parentElement.querySelector('div') : null;
  const before = box ? box.style.display : 'NO_BOX';
  if (toggle) toggle.click();
  const after = box ? box.style.display : 'NO_BOX';
  return JSON.stringify({ tabs, hasToggle: !!toggle, before, after });
})()`));
check("설정에서 «웹 캡처» 칸을 뺐다", setTabs.tabs.indexOf("웹 캡처") < 0, setTabs.tabs.join(" · "));
check("고급 · 관리자용은 접혀 있다", setTabs.hasToggle && setTabs.before === "none",
  setTabs.hasToggle ? `처음 ${setTabs.before}` : "여닫는 단추 없음");
check("고급 · 눌러야 펴진다", setTabs.after === "", `누른 뒤 ${setTabs.after || "(펴짐)"}`);
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);

/* ---------- 10-2. 넣기 줄 · ＋ 는 앞에 하나, 단추마다 그림글자 ---------- */
const addbar = JSON.parse(await evaluate(`(() => {
  const lead = document.querySelector('.addlead .addplus');
  const btns = Array.from(document.querySelectorAll('#addbar button[data-add]'))
    .map(b => ({ kind: b.getAttribute('data-add'), t: b.textContent.trim() }));
  return JSON.stringify({
    plus: lead ? lead.textContent.trim() : '',
    plusPx: lead ? Math.round(parseFloat(getComputedStyle(lead).fontSize)) : 0,
    btns: btns,
    withPlus: btns.filter(b => b.t.indexOf('＋') >= 0).length,
    svgs: document.querySelectorAll('#addbar [data-add] svg').length,
    // 그림글자(이모지)가 남아 있으면 안 된다
    emoji: /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(btns.map(b => b.t).join(''))
  });
})()`));
/* ＋ 를 단추마다 붙이면 열한 번 되풀이된다. 앞에 크게 하나만 세우면
   «이 아래는 다 넣는 것» 이라고 한 번에 읽히고, 단추 자리도 그만큼 넓어진다. */
check("넣기 줄 앞에 큰 ＋ 가 하나 선다", addbar.plus === "＋" && addbar.plusPx >= 20,
  `${addbar.plus || "없음"} · ${addbar.plusPx}px`);
check("단추마다 ＋ 를 되풀이하지 않는다", addbar.withPlus === 0, `＋ 붙은 단추 ${addbar.withPlus}개`);
check("단추마다 선 아이콘이 앞에 붙는다", addbar.svgs === addbar.btns.length,
  `${addbar.svgs}/${addbar.btns.length}개`);
/* ⚠️ 그림글자(이모지)는 안 쓴다. 기기마다 다른 그림이 나오고, 색도 우리 색을 안 따라온다.
   선 아이콘은 currentColor 라 어느 색감·밝기에서도 글자와 같은 색으로 선다. */
check("넣기 줄에 그림글자를 쓰지 않는다", !addbar.emoji, addbar.emoji ? "이모지가 남아 있다" : "선으로만");
/* 헷갈리기 쉬운 두 쌍은 아이콘 «그림» 이 서로 달라야 한다.
   캡처(직접 찍는 것) / 사진(이미 있는 것), 글(치는 것) / 손 메모(긋는 것) */
const shapes = JSON.parse(await evaluate(`JSON.stringify(
  ['capture','image','text','draw'].map(k => {
    const s = document.querySelector('#addbar [data-add="' + k + '"] svg');
    return s ? Array.from(s.querySelectorAll('path')).map(p => p.getAttribute('d')).join('|') : '';
  }))`));
check("헷갈리는 짝이 서로 다른 아이콘이다", new Set(shapes).size === 4 && shapes.every(Boolean),
  new Set(shapes).size + "가지");

/* ---------- 10-3. 보는 축 넷이 서로 안 흔들리는가 ----------
   모양 · 색감 · 밝기 · 글자 크기는 따로 도는 축이다. 하나를 고쳐도 나머지가 그대로여야
   «고른 것이 어긋나지 않는다». 여기서는 설정 화면에서 실제로 눌러 본다. */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
const axes = JSON.parse(await evaluate(`(() => {
  document.getElementById('btnSettings').click();
  const look = Array.from(document.querySelectorAll('.tabs .tab')).find(t => t.textContent === '모양');
  if (!look) return JSON.stringify({ err: 'NO_LOOK_TAB' });
  look.click();
  const press = (t) => {
    const b = Array.from(document.querySelectorAll('.pickbtn')).find(x => x.querySelector('.picklabel').textContent === t);
    if (b) b.click();
    return !!b;
  };
  const now = () => {
    const r = document.documentElement, cs = getComputedStyle(r);
    return { theme: r.getAttribute('data-theme'), mode: r.getAttribute('data-mode'),
             size: r.getAttribute('data-size'), fs: cs.getPropertyValue('--fs').trim() };
  };
  const labels = Array.from(document.querySelectorAll('.mbody .field > label')).map(l => l.textContent);
  // 모양을 «공책» 으로 두고 시작한다
  const card = Array.from(document.querySelectorAll('.themecard')).find(c => {
    const n = c.querySelector('.themename strong'); return n && n.textContent === '공책';
  });
  if (card) card.click();
  const a = now();
  const okDark = press('어둡게');   const b2 = now();
  const okHuge = press('아주 크게'); const c2 = now();
  const okLight = press('밝게');    const d2 = now();
  return JSON.stringify({ labels, okDark, okHuge, okLight, a, b: b2, c: c2, d: d2 });
})()`));
/* 모양이 레고 하나가 되며 «모양» 칸이 사라졌다. 남은 축은 셋이다 */
check("모양 칸에 축 셋이 다 있다", !axes.err && axes.labels.length === 3,
  axes.err || (axes.labels || []).join(" / "));
check("밝기를 고르면 그 자리에서 바뀐다", axes.b && axes.b.mode === "dark", (axes.b || {}).mode || "안 바뀜");
check("밝기를 바꿔도 모양은 그대로다", axes.b && axes.b.theme === axes.a.theme, `${axes.a.theme} → ${(axes.b||{}).theme}`);
check("글자를 키워도 밝기는 그대로다", axes.c && axes.c.mode === "dark" && axes.c.fs !== "1",
  `${(axes.c||{}).mode} · 배율 ${(axes.c||{}).fs}`);
check("밝게로 되돌려도 글자 크기는 그대로다", axes.d && axes.d.mode === "light" && axes.d.size === "huge",
  `${(axes.d||{}).mode} · ${(axes.d||{}).size}`);
check("넷을 다 만져도 모양은 끝까지 그대로다", axes.d && axes.d.theme === axes.a.theme,
  `${axes.a.theme} → ${(axes.d||{}).theme}`);

/* ---- 색감이 모양과 안 얽히는가 ----
   v7 전에는 색이 모양에 붙어 있어 「공책 모양에 청사진 색」 을 할 수 없었다.
   이제 색은 색감이, 모양은 모양이 쥔다. 서로 안 넘어와야 한다. */
const tone = JSON.parse(await evaluate(`(() => {
  const now = () => {
    const r = document.documentElement, cs = getComputedStyle(r);
    return { theme: r.getAttribute('data-theme'), tone: r.getAttribute('data-tone'),
             bg: cs.getPropertyValue('--bg').trim(), radius: cs.getPropertyValue('--radius').trim(),
             bw: cs.getPropertyValue('--bw').trim() };
  };
  const pickTone = (name) => {
    const b = Array.from(document.querySelectorAll('.tonebtn')).find(x => x.querySelector('strong').textContent === name);
    if (b) b.click();
    return !!b;
  };
  const names = Array.from(document.querySelectorAll('.tonebtn')).map(b => b.querySelector('strong').textContent);
  const a = now();                       // 공책 + (태어날 때 색)
  const okPick = pickTone('청사진');
  const b2 = now();                      // 공책 + 청사진
  // 「태어날 때의 색으로」 를 누르면 되돌아와야 한다
  const back = Array.from(document.querySelectorAll('.mbody button')).find(x => (x.textContent||'').includes('처음 색으로'));
  if (back) back.click();
  const c2 = now();
  return JSON.stringify({ names, okPick, a, b: b2, c: c2 });
})()`));
check("색감 일곱이 다 있다", (tone.names || []).length === 7, (tone.names || []).join(" · "));
check("색감을 바꾸면 색이 바뀐다", tone.okPick && tone.b.tone === "blue" && tone.b.bg !== tone.a.bg,
  `${tone.a.bg} → ${(tone.b||{}).bg}`);
check("색감을 바꿔도 모양은 그대로다",
  tone.b && tone.b.theme === tone.a.theme && tone.b.radius === tone.a.radius && tone.b.bw === tone.a.bw,
  `모서리 ${tone.a.radius}→${(tone.b||{}).radius} · 테두리 ${tone.a.bw}→${(tone.b||{}).bw}`);
/* «처음 색으로» 는 «지금 색» 이 아니라 «태어날 때의 색» 으로 되돌리는 단추다.
   앞선 점검이 딴 색을 골라 두었을 수 있으므로, 태어날 때의 색으로 견준다. */
check("«처음 색으로» 가 되돌린다", tone.c && tone.c.tone === "clean",
  `${(tone.c||{}).tone} · ${(tone.c||{}).bg}`);
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);

/* ---------- 10-4. 말이 다시 늘어나지 않았는가 ----------
   ⚠️ 쓰기 전에 읽어야 할 글이 있으면 사람들은 그냥 안 쓴다.
      화면이 이미 말하고 있는 것(단추 이름·라벨·자리글)은 설명하지 않는다.
      남길 것은 «되돌릴 수 없는 것» 과 «안 되는 것» 뿐이고, 그것도 한 줄이다.
      이 줄이 빨개지면 «설명을 또 붙였다» 는 뜻이다. 붙이지 말고 화면으로 말할 것. */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
const wordy = JSON.parse(await evaluate(`(() => {
  const long = [];
  document.querySelectorAll('.desc, .crophint, .addhint').forEach(e => {
    const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t.length > 45) long.push(t.slice(0, 40));
  });
  return JSON.stringify({ n: long.length, first: long[0] || '' });
})()`));
check("첫 화면에 긴 설명이 없다", wordy.n === 0, wordy.first || "45자 넘는 것 없음");

const voiceWords = JSON.parse(await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('[data-add]')).find(x => (x.textContent||'').includes('녹음'));
  if (!b) return JSON.stringify({ err: 'NO_BUTTON' });
  b.click();
  const m = document.querySelector('.modal-bg .card.modal');
  if (!m) return JSON.stringify({ err: 'NO_MODAL' });
  const t = (m.querySelector('.mbody').textContent || '').replace(/\\s+/g, '').trim();
  return JSON.stringify({ chars: t.length, head: t.slice(0, 40) });
})()`));
/* 녹음 창은 «시계 · 제목 · 받아 적은 글» 이면 된다. 그 밖의 글자가 붙으면 설명이 돌아온 것이다. */
check("녹음 창에 설명이 없다", !voiceWords.err && voiceWords.chars < 40,
  voiceWords.err || `글자 ${voiceWords.chars}자`);
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);

/* ---------- 10-9. 왼쪽 폴더 구조 · PC 기둥과 폰 서랍 ----------
   같은 것을 자리만 달리해 보여 준다. PC 에서는 늘 보이는 왼쪽 기둥,
   폰에서는 줄 셋(☰)으로 여는 서랍. 배우는 것이 하나여야 한다. */
const side = JSON.parse(await evaluate(`(() => {
  const nav = document.getElementById('sideNav');
  if (!nav) return JSON.stringify({ err: 'NO_NAV' });
  const cs = getComputedStyle(nav);
  return JSON.stringify({
    visible: cs.display !== 'none' && cs.transform === 'none',
    rows: nav.querySelectorAll('.siderow').length,
    root: (nav.querySelector('.siderow .n') || {}).textContent || '',
    topNew: !!document.getElementById('topNew'),
    topNewShown: (() => { const b = document.getElementById('topNew'); return !!b && getComputedStyle(b).display !== 'none'; })(),
    sideAdd: !!nav.querySelector('.sidenew'),
    burger: getComputedStyle(document.getElementById('btnDrawer')).display
  });
})()`));
check("PC 에서는 왼쪽에 폴더 구조 기둥이 선다", !side.err && side.visible && side.rows >= 1,
  side.err || `줄 ${side.rows}개 · 뿌리 「${side.root}」`);
/* ⚠️ 「＋ 새 기록」 은 머리띠로 옮겼다. 기둥 맨 아래에 두었더니 폴더가 열댓 개인
   사람에게는 화면 밖으로 밀려나 «어떻게 쓰냐» 가 됐다.
   가장 자주 누르는 단추는 목록 길이에 밀리지 않는 자리에 있어야 한다. */
check("«＋ 새 기록» 이 머리띠에 있다", side.topNew === true && side.topNewShown === true);
check("기둥 아래에는 그 단추를 두 번 두지 않는다", side.sideAdd === false);
/* ☰ 는 이제 PC 에도 있다 · «한 겹씩 걷는다». 한 단추, 한 뜻 */
check("PC 에도 줄 셋(☰)이 있다", side.burger !== "none", String(side.burger));
/* ⚠️ 열고/끄는 두 단이던 것을 세 단으로 바꿨다.
     0 · 기둥 │ 목록 │ 쓰는 자리   1 · 목록 │ 쓰는 자리   2 · 쓰는 자리만
   칸을 감출 때 격자 폭도 같이 줄어야 «빈 흰 판» 이 안 남는다 · 그것까지 잰다. */
const folded = JSON.parse(await evaluate(`(() => {
  const btn = document.getElementById('btnDrawer');
  const L = document.querySelector('.layout');
  const gone = sel => { const e = document.querySelector(sel); return !e || getComputedStyle(e).display === 'none'; };
  const now = () => ({
    nav: L.getAttribute('data-nav'),
    cols: getComputedStyle(L).gridTemplateColumns.split(' ').length,
    폭합: Math.round(getComputedStyle(L).gridTemplateColumns.split(' ').reduce((a, v) => a + parseFloat(v), 0)),
    칸너비: Math.round(L.getBoundingClientRect().width),
    기둥감춤: gone('#sideNav'), 목록감춤: gone('.listcol')
  });
  btn.click(); const one = now();
  btn.click(); const two = now();
  btn.click(); const back = now();
  return JSON.stringify({ one, two, back, 화면: innerWidth });
})()`));
check("한 번 누르면 기둥이 접힌다",
  folded.one.nav === "1" && folded.one.기둥감춤 === true && folded.one.목록감춤 === false,
  "단 " + folded.one.nav + " · 칸 " + folded.one.cols);
check("두 번째로 누르면 목록까지 접힌다",
  folded.two.nav === "2" && folded.two.목록감춤 === true,
  "단 " + folded.two.nav + " · 칸 " + folded.two.cols);
check("세 번째로 누르면 다시 다 펴진다",
  folded.back.nav === "0" && folded.back.기둥감춤 === false && folded.back.목록감춤 === false,
  "단 " + folded.back.nav + " · 칸 " + folded.back.cols);
/* ⚠️ 접었는데 그 자리가 빈 판으로 남으면 접은 것이 아니다 · 칸들이 판을 다 채워야 한다.
   ⚠️ 화면 너비(innerWidth)와 재면 안 된다. 쪽에 세로 굴림 막대가 서는 순간 15px 이
      어긋나서, 멀쩡한 것을 «빈 자리가 있다» 고 말한다 · 판 자신의 너비와 잰다. */
check("어느 단에서도 빈 자리가 안 남는다",
  [folded.one, folded.two, folded.back].every(function (x) { return Math.abs(x.폭합 - x.칸너비) <= 1; }),
  [folded.one, folded.two, folded.back].map(function (x) { return x.폭합 + "/" + x.칸너비; }).join(" · "));

await twoPane(); await wait(500);
/* ---------- 10-2. 자리 · 왼쪽에서 고른 폴더가 곧 «다음 기록이 갈 자리» ----------
   ⚠️ 여기부터는 «2단 화면» 이야기다. 3단에서는 오른쪽 칸이 늘 쓰는 자리라 접지 않는다. 
   기둥은 원래도 목록을 좁혀 주고 있었다. 그런데 작성칸이 화면 한 장 반을 먹고 있어서
   좁혀진 목록이 «안 보이는 자리» 에 있었고, 누른 사람 눈에는 아무 일도 안 일어났다.
   이제 볼 때는 작성칸이 접히고, 고른 폴더가 그대로 쓰는 자리가 된다. */
const deskPick = JSON.parse(await evaluate(`(() => {
  const nav = document.getElementById('sideNav');
  const rows = Array.from(nav.querySelectorAll('.siderow'));
  const target = rows.find(r => ((r.querySelector('.n')||{}).textContent) === '평가');
  if (!target) return JSON.stringify({ err: 'NO_ROW', names: rows.map(r => (r.querySelector('.n')||{}).textContent) });
  const treeCount = parseInt(((target.querySelector('.cnt')||{}).textContent) || '0', 10);
  // 앞선 점검이 남긴 거르개가 있으면 걷어낸다 · 자리 점검은 «폴더 하나» 만 재는 자리다
  const clear = Array.from(document.querySelectorAll('.filters .chip'))
    .find(c => c.textContent.indexOf('필터 지우기') >= 0);
  if (clear) clear.click();
  target.click();
  const c = document.getElementById('composer');
  const shown = Array.from(c.children).filter(ch => getComputedStyle(ch).display !== 'none');
  const now = Array.from(nav.querySelectorAll('.siderow')).find(r => ((r.querySelector('.n')||{}).textContent) === '평가');
  return JSON.stringify({
    collapsed: c.classList.contains('cfolded'),
    onlyFold: shown.length === 1 && shown[0].className === 'cfold',
    height: Math.round(c.getBoundingClientRect().height),
    where: (document.getElementById('cfoldWhere')||{}).textContent || '',
    marked: !!now && now.className.indexOf('desk') >= 0,
    treeCount,
    shown: document.querySelectorAll('#list .entry').length,
    total: JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]').length,
    desk: localStorage.getItem('pkos.desk.v1') || ''
  });
})()`));
check("폴더를 누르면 작성칸이 접힌다", !deskPick.err && deskPick.collapsed && deskPick.height < 140,
  deskPick.err ? JSON.stringify(deskPick.names) : `${deskPick.height}px`);
check("접힌 자리에는 «＋ 새 기록» 한 줄만 남는다", !!deskPick.onlyFold);
check("접힌 줄이 어디에 쓰는지 말해 준다", /평가/.test(deskPick.where), (deskPick.where || "").trim());
check("고른 폴더가 곧 쓰는 자리가 된다", /"path":\["평가"\]/.test(deskPick.desk), deskPick.desk);
check("왼쪽에도 «여기에 씁니다» 가 표시된다", !!deskPick.marked);
/* ⚠️ «몇 개인지» 까지 재야 한다. 예전에는 거르는 자가 srcPath 만 보아서, 나무에는 7개라고
   적혀 있는 폴더를 눌러도 목록이 텅 비었다 (앱이 만든 기록은 srcPath 가 비어 있다).
   숫자를 안 재면 «좁혀지긴 했다» 로 통과해 버린다. 0개로 좁혀진 것도 좁혀진 것이다. */
check("목록이 그 폴더 아래로 좁혀진다", deskPick.shown > 0 && deskPick.shown < deskPick.total,
  `${deskPick.shown} / ${deskPick.total}개 · 나무엔 ${deskPick.treeCount}개`);
check("좁혀진 수가 나무에 적힌 수와 같다", deskPick.shown === deskPick.treeCount,
  `목록 ${deskPick.shown} · 나무 ${deskPick.treeCount}`);

const unfold = JSON.parse(await evaluate(`(() => {
  document.getElementById('btnUnfold').click();
  const c = document.getElementById('composer');
  return JSON.stringify({
    open: !c.classList.contains('cfolded'),
    line: (document.getElementById('deskLine')||{}).textContent || ''
  });
})()`));
check("«＋ 새 기록» 을 누르면 다시 펴진다", unfold.open);
check("작성칸 맨 위가 갈 자리를 적어 둔다", /평가/.test(unfold.line), (unfold.line || "").trim());

/* 쓰던 글이 있는데 접으면 사라진 줄 안다. 그때는 자리만 바뀌고 작성칸은 그대로 둔다 */
const busy = JSON.parse(await evaluate(`(() => {
  const t = document.getElementById('title');
  t.value = '쓰다 만 것';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  const rows = Array.from(document.querySelectorAll('#sideNav .siderow'));
  const other = rows.find(r => ((r.querySelector('.n')||{}).textContent) === '연수');
  if (other) other.click();
  return JSON.stringify({
    stillOpen: !document.getElementById('composer').classList.contains('cfolded'),
    kept: document.getElementById('title').value
  });
})()`));
check("쓰던 글이 있으면 접지 않는다", busy.stillOpen && busy.kept === "쓰다 만 것", busy.kept);

const savedDesk = JSON.parse(await evaluate(`(() => {
  document.getElementById('btnSave').click();
  const list = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  const n = list[0] || {};
  return JSON.stringify({ title: n.title || '', deskPath: n.deskPath || [], folderId: n.folderId || null });
})()`));
check("새 기록에 고른 자리가 찍힌다", savedDesk.deskPath[0] === "연수", JSON.stringify(savedDesk.deskPath));
/* ⚠️ 이것이 이 기능의 핵심 안전장치다. folderId 는 «기록 하나가 통째로 가진 폴더» 라
   지우기가 그리로 향한다(removeEntry). 여러 기록이 함께 쓰는 사업 폴더를 거기에 걸면
   한 편을 지웠을 때 폴더가 통째로 휴지통에 간다. 그래서 칸을 따로 두었다. */
check("자리를 folderId 에 걸지 않는다 (한 편 지워도 폴더가 안 날아간다)",
  savedDesk.folderId === null, String(savedDesk.folderId));

/* ⚠️ ▾ 는 기둥이 아니라 머리띠의 «＋ 새 기록» 옆에 있다 · 떠 있는 메뉴로 뜬다 */
const deskMenuChk = JSON.parse(await evaluate(`(() => {
  const more = document.getElementById('topNewMore');
  if (!more) return JSON.stringify({ err: 'NO_BUTTON' });
  more.click();
  const m = document.querySelector('.menupop');
  if (!m) return JSON.stringify({ err: 'NO_MENU' });
  const out = {
    items: Array.from(m.querySelectorAll('button')).map(b => (b.firstChild||{}).textContent || ''),
    note: Array.from(m.querySelectorAll('small')).map(x => x.textContent).join(' ')
  };
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return JSON.stringify(out);
})()`));
/* ⚠️ ▾ 안에는 양식도 같이 산다. 여기서 세는 것은 «자리를 바꾸는 길» 셋뿐이다 */
const deskWays = (deskMenuChk.items || []).filter(function (t) { return !/^📋/.test(t); });
check("▾ 안에 자리 바꾸는 길 셋이 있다", !deskMenuChk.err && deskWays.length === 3,
  deskWays.join(" / "));
/* 실측해 둔 한계다 · 안 적으면 «앱이 고장났다» 가 된다 */
check("고른 폴더에 원래 있던 것은 안 보인다고 미리 말한다", /원래 있던 파일은/.test(deskMenuChk.note || ""));

const deskHome = JSON.parse(await evaluate(`(() => {
  document.getElementById('topNewMore').click();
  const btns = Array.from(document.querySelectorAll('.menupop button'));
  const h = btns.find(b => b.textContent.indexOf('기본 자리') >= 0);
  if (h) h.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return JSON.stringify({
    desk: localStorage.getItem('pkos.desk.v1') || '',
    marked: Array.from(document.querySelectorAll('#sideNav .siderow')).filter(r => r.className.indexOf('desk') >= 0).length
  });
})()`));
check("«기본 자리» 로 되돌아온다", deskHome.desk === "" && deskHome.marked === 0, deskHome.desk);

/* 나무는 처음부터 두 겹까지 펴져 있어야 한다 · 접힌 지도는 지도 구실을 못 한다 */
const deskDepth = JSON.parse(await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#sideNav .siderow'));
  return JSON.stringify({ depths: rows.map(r => (r.className.match(/\\bd(\\d)\\b/) || [0, 0])[1]) });
})()`));
check("나무가 처음부터 한 겹 더 펴져 있다", deskDepth.depths.filter((d) => String(d) === "1").length >= 2,
  deskDepth.depths.join(","));
await anyPane(); await wait(400);
/* ---------- 10-3. 폴더 «밖» 으로 나간 것과 «정말 없는» 것을 가른다 ----------
   drive.file 권한은 파일 하나하나에 붙는다 · 폴더에 붙는 것이 아니다. 그래서 앱이 만든 파일은
   사람이 드라이브에서 딴 데로 옮겨도 계속 열린다 (이 앱은 글도 사진도 파일 ID 로 읽는다).
   ⚠️ 폴더 훑기가 못 찾았다고 곧바로 「안 보입니다」 를 띄우면, 멀쩡히 읽히는 기록을
      고장난 것처럼 보여 준다. 그래서 파일에게 직접 물어본 뒤에 가른다. 두 말은 달라야 한다. */
await evaluate(`(() => {
  const mk = (id, title, extra) => Object.assign({
    id, type: '', title, tags: ['수업'], blocks: [{ id: 'b' + id, kind: 'text', text: title }],
    relations: [], pinned: false, createdAt: 1755000000000, updatedAt: 1755000000000,
    srcPath: ['수업'], mdId: 'MD_' + id
  }, extra || {});
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    mk('w1', '밖으로 옮겨진 기록', { _away: true, _awayName: '수업_회고.md' }),
    mk('w2', '정말 사라진 기록', { _missing: true }),
    mk('w3', '멀쩡한 기록', {})
  ]));
  localStorage.removeItem('pkos.draft.v1');
  localStorage.removeItem('pkos.desk.v1');
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const away = JSON.parse(await evaluate(`(() => {
  const out = {};
  Array.from(document.querySelectorAll('#list .entry')).forEach(card => {
    const b = card.querySelector('.banner');
    const key = card.textContent.indexOf('밖으로 옮겨진') >= 0 ? 'moved'
              : card.textContent.indexOf('정말 사라진') >= 0 ? 'gone' : 'fine';
    out[key] = {
      cls: b ? b.className : '',
      text: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '',
      href: (b && b.querySelector('a')) ? b.querySelector('a').getAttribute('href') : '',
      readable: card.textContent.length > 20
    };
  });
  return JSON.stringify(out);
})()`));
check("폴더 밖으로 나간 것을 «없다» 고 하지 않는다",
  (away.moved || {}).cls === "banner away" && /문제없습니다/.test((away.moved || {}).text || ""),
  (away.moved || {}).text || "(배너 없음)");
check("밖에 있는 것도 그대로 읽힌다", !!(away.moved || {}).readable);
check("밖에 있는 파일로 바로 가는 문이 있다", /drive\.google\.com\/file\/d\/MD_w1/.test((away.moved || {}).href || ""),
  (away.moved || {}).href || "");
check("정말 못 여는 것은 따로 말한다", (away.gone || {}).cls === "banner gone" && /안 보입니다/.test((away.gone || {}).text || ""),
  (away.gone || {}).text || "(배너 없음)");
check("멀쩡한 기록에는 아무 말도 안 붙인다", (away.fine || {}).cls === "", (away.fine || {}).cls || "(없음)");

/* ---------- 10-4. 같은 이름이면 같은 수여야 한다 ----------
   「태그가 곧 폴더」 에서 태그 칩과 왼쪽 나무는 «같은 것» 을 센다. 그런데 예전에는
   나무가 첫 태그 하나만 세어서, 한 화면에 「#수업 4」 와 「수업 2」 가 나란히 떴다.
   두 번째 태그로만 쓰인 태그는 폴더 자체가 나무에 없었다 — 드라이브에는 바로가기가
   놓여 있는데도. 화면이 드라이브와 어긋나 있었던 것이다.
   ⚠️ 세 숫자(칩·나무·눌렀을 때 나오는 수)가 전부 같아야 한다. 하나라도 다르면
      쓰는 사람은 «뭐가 맞는 거냐» 가 된다. */
await evaluate(`(() => {
  const mk = (id, title, tags) => ({
    id, type: '', title, tags, blocks: [{ id: 'b' + id, kind: 'text', text: title }],
    relations: [], pinned: false, createdAt: 1755000000000, updatedAt: 1755000000000
  });
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    mk('g1', '질문중심 수업 설계', ['수업', '질문']),
    mk('g2', '배움중심 평가 논의', ['수업', '평가']),
    mk('g3', '서논술형 문항', ['평가', '수업']),
    mk('g4', '연수 회고', ['연수', '수업'])
  ]));
  const s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.folderMode = 'tag';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  ['pkos.desk.v1','pkos.deskList.v1','pkos.sideOpen.v1','pkos.draft.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const tally = JSON.parse(await evaluate(`(() => {
  const clr = () => { const c = Array.from(document.querySelectorAll('.filters .chip')).find(x => x.textContent.indexOf('필터 지우기') >= 0); if (c) c.click(); };
  clr();
  const chips = {};
  Array.from(document.querySelectorAll('#tagFilters .chip')).forEach(c => {
    const m = c.textContent.trim().match(/^#(\\S+)\\s+(\\d+)$/);
    if (m) chips[m[1]] = +m[2];
  });
  const tree = {};
  Array.from(document.querySelectorAll('#sideNav .siderow')).forEach(r => {
    const nm = (r.querySelector('.n') || {}).textContent;
    const c = (r.querySelector('.cnt') || {}).textContent;
    if (nm && r.className.indexOf('d1') >= 0) tree[nm] = +c;
  });
  const clicked = {};
  Object.keys(tree).forEach(nm => {
    const row = Array.from(document.querySelectorAll('#sideNav .siderow')).find(r => ((r.querySelector('.n') || {}).textContent) === nm);
    if (row) { row.click(); clicked[nm] = document.querySelectorAll('#list .entry').length; }
  });
  clr();
  const names = Object.keys(chips).concat(Object.keys(tree)).filter((v, i, a) => a.indexOf(v) === i);
  const bad = names.filter(nm => !(chips[nm] === tree[nm] && tree[nm] === clicked[nm]));
  return JSON.stringify({ chips, tree, clicked, bad });
})()`));
check("두 번째 태그도 나무에 폴더로 선다", tally.tree && tally.tree["질문"] === 1,
  "질문 " + (tally.tree ? (tally.tree["질문"] === undefined ? "폴더 없음" : tally.tree["질문"]) : "?"));
check("태그 칩과 나무가 같은 수를 말한다", (tally.bad || []).length === 0,
  (tally.bad || []).map(function (nm) {
    return nm + " · 칩 " + tally.chips[nm] + " / 나무 " + tally.tree[nm] + " / 눌러서 " + tally.clicked[nm];
  }).join(" · ") || ("수업 " + (tally.tree || {})["수업"] + "편으로 일치"));

/* ---------- 10-5. 방금 만든 태그가 «가장 안 보이는» 자리로 가면 안 된다 ----------
   태그 칩은 「많이 쓴 순」 하나로만 세우고 열두 개에서 잘랐다. 그러면 새로 만든 태그는
   언제나 하나짜리라 맨 뒤로 밀려 「더 보기」 뒤에 숨는다. 새 태그를 붙인 «바로 그때» 가
   그 태그를 가장 찾고 싶은 때인데 말이다 — 「배움 이라고 넣었는데 안 뜬다」 가 그것이었다. */
await evaluate(`(() => {
  const old = ['수업','평가','연수','질문','대학원','아이디어','업무','성찰','부기','독서','기록','도구','회의','학부모'];
  const list = [];
  old.forEach((t, i) => {
    for (let k = 0; k < (14 - i); k++) list.push({
      id: 'o' + i + '_' + k, type: '', title: t + ' 기록 ' + k, tags: [t],
      blocks: [], relations: [], pinned: false, createdAt: 1700000000000, updatedAt: 1700000000000
    });
  });
  list.unshift({ id: 'fresh1', type: '', title: '오늘 쓴 배움 기록', tags: ['배움'],
    blocks: [], relations: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() });
  localStorage.setItem('pkos.entries.v2', JSON.stringify(list));
  ['pkos.desk.v1','pkos.deskList.v1','pkos.sideOpen.v1','pkos.draft.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const freshTag = JSON.parse(await evaluate(`(() => {
  const chips = Array.from(document.querySelectorAll('#tagFilters .chip')).map(c => c.textContent.trim());
  const idx = chips.findIndex(c => c.indexOf('배움') >= 0);
  const tree = Array.from(document.querySelectorAll('#sideNav .siderow'))
    .map(r => (r.querySelector('.n') || {}).textContent);
  return JSON.stringify({ chips, idx, inTree: tree.indexOf('배움') >= 0, total: chips.length });
})()`));
check("방금 만든 태그가 칩에 보인다", freshTag.idx >= 0,
  freshTag.idx >= 0 ? (freshTag.idx + 1) + "번째" : "「더 보기」 뒤에 숨음 · " + (freshTag.chips || []).join(" "));
check("방금 만든 태그가 앞줄에 선다", freshTag.idx === 0, "자리 " + (freshTag.idx + 1));
check("칩에 보이는 태그는 나무에도 있다", !!freshTag.inTree);

/* 태그는 폴더 이름이 된다. 폴더로 못 쓰는 글자가 들어오면 칩과 드라이브가 어긋난다.
   같은 태그를 두 번 적은 것도 하나로 만든다. */
const tagClean = JSON.parse(await evaluate(`(() => {
  const t = document.getElementById('title'); t.value = '태그 정리';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  const g = document.getElementById('tags');
  g.value = ' 배움 , 배움,  수업/평가 , , 배움 ';
  g.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('btnSave').click();
  const n = JSON.parse(localStorage.getItem('pkos.entries.v2'))[0];
  return JSON.stringify({ tags: n.tags || [] });
})()`));
check("같은 태그를 두 번 적어도 하나로 든다", (tagClean.tags || []).filter(function (t) { return t === "배움"; }).length === 1,
  JSON.stringify(tagClean.tags));
check("폴더로 못 쓰는 글자는 들어올 때 정리된다", (tagClean.tags || []).indexOf("수업 평가") >= 0,
  JSON.stringify(tagClean.tags));

/* 거르개는 다 같이 걸려야 한다 · 폴더를 골랐으면 칩도 그 폴더 기준으로 센다 */
const chipScope = JSON.parse(await evaluate(`(() => {
  const before = Array.from(document.querySelectorAll('#tagFilters .chip')).map(c => c.textContent.trim());
  const row = Array.from(document.querySelectorAll('#sideNav .siderow')).find(r => ((r.querySelector('.n') || {}).textContent) === '연수');
  if (!row) return JSON.stringify({ err: 'NO_ROW' });
  row.click();
  const after = Array.from(document.querySelectorAll('#tagFilters .chip'))
    .map(c => c.textContent.trim()).filter(c => c.charAt(0) === '#');
  return JSON.stringify({ before: before.length, after });
})()`));
check("폴더를 고르면 태그 칩도 그 폴더 기준으로 센다",
  !chipScope.err && (chipScope.after || []).length === 1 && /연수/.test((chipScope.after || [])[0] || ""),
  (chipScope.after || []).join(" ") || chipScope.err);

/* ---------- 10-6. 업노트식 블록 여섯 ----------
   할 일 · 목록 · 코드 · 표 · 접이식 · 글 안 서식.
   ⚠️ 가장 중요한 것은 «목록에서 바로 체크된다» 는 것이다. 읽다가 한 일이 생각나면
      그 자리에서 누른다. 편집으로 들어갔다 나오는 순간 그 기능은 죽은 기능이 된다. */
await evaluate(`(() => {
  localStorage.setItem('pkos.entries.v2', '[]');
  ['pkos.draft.v1','pkos.desk.v1','pkos.deskList.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const blockKinds = JSON.parse(await evaluate(`(() => {
  // 자주 안 쓰는 갈래는 접혀 있다 · 처음 보이는 것과 펴면 나오는 것을 따로 센다
  const vis = () => Array.from(document.querySelectorAll('#addbar [data-add]'))
    .filter(b => getComputedStyle(b).display !== 'none').map(b => b.getAttribute('data-add'));
  // 앞선 점검이 펴 놓았을 수 있다 · 접힌 상태에서 재야 «처음 보이는 것» 을 세는 것이다
  if (document.getElementById('addbar').classList.contains('open')) document.getElementById('btnAddMore').click();
  const outer = vis();
  document.getElementById('btnAddMore').click();
  const inner = vis().filter(k => outer.indexOf(k) < 0);
  document.getElementById('btnAddMore').click();
  // 세고 나서, 이 뒤의 점검이 쓸 블록들을 실제로 넣어 둔다
  ['todo', 'list', 'table'].forEach(k => { const b = document.querySelector('[data-add="' + k + '"]'); if (b) b.click(); });
  return JSON.stringify({ buttons: outer, inner, barCount: outer.length + 1 });
})()`));
check("매일 쓰는 갈래는 넣기 줄 밖에 있다",
  ["todo", "list", "table"].every(function (k) { return (blockKinds.buttons || []).indexOf(k) >= 0; }),
  (blockKinds.buttons || []).join(" "));
check("가끔 쓰는 갈래는 접혀 있다가 펴진다",
  ["quote", "code", "fold", "divider", "voice", "draw"].every(function (k) {
    return (blockKinds.inner || []).indexOf(k) >= 0;
  }), (blockKinds.inner || []).join(" "));
/* ⚠️ 넣기 줄이 열여섯 개가 되면 폰에서 여섯 줄을 먹는다 · 고르는 자리가 아니라 벽이 된다 */
check("넣기 줄이 열 개를 안 넘는다", blockKinds.barCount <= 10, blockKinds.barCount + "개");

const built = JSON.parse(await evaluate(`(() => {
  const t = document.getElementById('title');
  t.value = '업노트식 블록'; t.dispatchEvent(new Event('input', { bubbles: true }));
  // 할 일 두 줄
  const lines = Array.from(document.querySelectorAll('#blocks .lineinp'));
  lines[0].value = '숙제 끝내기'; lines[0].dispatchEvent(new Event('input', { bubbles: true }));
  lines[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const l2 = Array.from(document.querySelectorAll('#blocks .lineinp'));
  l2[1].value = '표 예매'; l2[1].dispatchEvent(new Event('input', { bubbles: true }));
  // 목록 · 들여쓰기
  l2[2].value = '겉 항목'; l2[2].dispatchEvent(new Event('input', { bubbles: true }));
  l2[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const l3 = Array.from(document.querySelectorAll('#blocks .lineinp'));
  l3[3].value = '속 항목'; l3[3].dispatchEvent(new Event('input', { bubbles: true }));
  l3[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  // 코드
  // 코드·접이식은 접힌 쪽에 있다 · 한 번 펴고 누른다
  if (!document.getElementById('addbar').classList.contains('open')) document.getElementById('btnAddMore').click();
  ['code', 'fold'].forEach(k => { const b = document.querySelector('[data-add="' + k + '"]'); if (b) b.click(); });
  const ct = Array.from(document.querySelectorAll('#blocks textarea.mono')).pop();
  ct.value = "const a = 1"; ct.dispatchEvent(new Event('input', { bubbles: true }));
  // 표
  const cells = Array.from(document.querySelectorAll('#blocks .tcell'));
  ['요일','할 일','Day 1','이동'].forEach((v, i) => {
    if (cells[i]) { cells[i].value = v; cells[i].dispatchEvent(new Event('input', { bubbles: true })); }
  });
  // 접이식
  const fi = Array.from(document.querySelectorAll('#blocks input.inp')).filter(i => (i.placeholder || '').indexOf('접었을 때') >= 0)[0];
  fi.value = '6월 13-19'; fi.dispatchEvent(new Event('input', { bubbles: true }));
  const fa = Array.from(document.querySelectorAll('#blocks textarea.inp')).filter(x => !x.classList.contains('mono')).pop();
  fa.value = '세탁물 찾기'; fa.dispatchEvent(new Event('input', { bubbles: true }));
  // 서식 단추로 굵게
  const bar = fa.parentElement.querySelector('.fmtbar');
  const hl = bar ? bar.querySelectorAll('.hlbtn').length : 0;
  fa.focus(); fa.setSelectionRange(0, 3);
  if (bar) bar.querySelectorAll('.fmtbtn')[0].click();
  const marked = fa.value;
  document.getElementById('btnSave').click();
  const n = JSON.parse(localStorage.getItem('pkos.entries.v2'))[0] || {};
  return JSON.stringify({ hl, marked, kinds: (n.blocks || []).map(b => b.kind) });
})()`));
check("한 기록에 다섯 갈래가 함께 담긴다",
  ["todo", "list", "code", "table", "fold"].every(function (k) { return (built.kinds || []).indexOf(k) >= 0; }),
  (built.kinds || []).join(" "));
check("형광펜이 여섯 색이다", built.hl === 6, String(built.hl) + "색");
check("서식 단추가 마크다운 기호를 대신 넣는다", /^\*\*/.test(built.marked || ""), built.marked || "");

const shownBlocks = JSON.parse(await evaluate(`(() => {
  const card = document.querySelector('#list .entry');
  if (!card) return JSON.stringify({ err: 'NO_CARD' });
  return JSON.stringify({
    todo: card.querySelectorAll('.todolist input[type=checkbox]').length,
    bullets: !!card.querySelector('.bullets'),
    nested: !!card.querySelector('.bullets li.d1'),
    code: !!card.querySelector('.codeblock'),
    table: card.querySelectorAll('table.shown th').length,
    fold: !!card.querySelector('details.foldbox'),
    bold: !!card.querySelector('b'),
    count: (card.querySelector('.todocount') || {}).textContent || ''
  });
})()`));
check("표가 머리줄을 갖고 그려진다", shownBlocks.table === 2, "머리 " + shownBlocks.table + "칸");
check("접이식이 details 로 그려진다", !!shownBlocks.fold);
check("중첩 목록이 한 겹 들어간다", !!shownBlocks.nested);
check("코드 블록이 따로 그려진다", !!shownBlocks.code);
check("서식이 화면에 입혀진다", !!shownBlocks.bold);

/* ⚠️ 이것이 이 블록의 전부다 · 목록에서 «바로» 체크되고, 누른 즉시 저장돼야 한다 */
const ticked = JSON.parse(await evaluate(`(() => {
  const before = (document.querySelector('#list .todocount') || {}).textContent || '';
  const box = document.querySelector('#list .todolist input[type=checkbox]');
  if (!box) return JSON.stringify({ err: 'NO_BOX' });
  box.click();
  const after = (document.querySelector('#list .todocount') || {}).textContent || '';
  const n = JSON.parse(localStorage.getItem('pkos.entries.v2'))[0];
  const todo = (n.blocks || []).filter(b => b.kind === 'todo')[0] || {};
  return JSON.stringify({ before, after, saved: ((todo.items || [])[0] || {}).done === true });
})()`));
check("목록에서 바로 체크된다", ticked.saved === true, ticked.err || "저장됨");
check("체크하면 «몇 개 했는지» 도 같이 바뀐다", ticked.before !== ticked.after,
  (ticked.before || "?") + " → " + (ticked.after || "?"));

/* ---------- 10-7. 업노트식 왼쪽 기둥 ----------
   폴더는 «내가 어디에 두었나» 로 찾는 길이고, 똑똑한 목록은 «지금 뭘 해야 하나» 로 찾는 길이다.
   둘은 다른 물음이라 자리를 나눠 세운다. 태그는 또 다른 길이다 (폴더는 한 자리, 태그는 여러 갈래). */
await evaluate(`(() => {
  const mk = (id, title, tags, todo, pin) => ({
    id, type: '', title, tags,
    blocks: todo ? [{ id: 'b' + id, kind: 'todo', items: [{ t: '할 것', done: false }] }]
                 : [{ id: 'b' + id, kind: 'text', text: title }],
    relations: [], pinned: !!pin, createdAt: 1755000000000, updatedAt: 1755000000000
  });
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    mk('v1', '수업 회고', ['수업'], false, false),
    mk('v2', '고정해 둔 기록', ['수업'], false, true),
    mk('v3', '할 일이 남은 기록', ['업무'], true, false),
    mk('v4', '태그 없는 기록', [], false, false)
  ]));
  ['pkos.desk.v1','pkos.deskList.v1','pkos.draft.v1','pkos.sideOpen.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const pillar = JSON.parse(await evaluate(`(() => {
  const caps = Array.from(document.querySelectorAll('#sideNav .sidecap')).map(c => c.textContent).filter(Boolean);
  const smart = Array.from(document.querySelectorAll('#sideNav .smartrow')).map(b => (b.querySelector('.n') || {}).textContent);
  const quick = Array.from(document.querySelectorAll('#sideNav .quickrow')).map(b => (b.querySelector('.n') || {}).textContent);
  const tags = Array.from(document.querySelectorAll('#sideNav .tagrow')).map(b => (b.querySelector('.n') || {}).textContent);
  return JSON.stringify({ caps, smart, quick, tags });
})()`));
check("기둥이 구역으로 나뉜다", ["빠른 접근", "폴더 구조", "태그"].every(function (k) {
  return (pillar.caps || []).some(function (c) { return c.indexOf(k) >= 0; });
}), (pillar.caps || []).join(" / "));
check("«모든 기록 · 할 일 · 분류 없음» 이 선다",
  ["모든 기록", "할 일", "분류 없음"].every(function (k) { return (pillar.smart || []).indexOf(k) >= 0; }),
  (pillar.smart || []).join(" · "));
check("고정한 기록이 빠른 접근에 뜬다", (pillar.quick || []).indexOf("고정해 둔 기록") >= 0,
  (pillar.quick || []).join(" · "));
check("태그가 기둥에도 선다", (pillar.tags || []).length >= 2, (pillar.tags || []).join(" · "));

const smartPick = JSON.parse(await evaluate(`(() => {
  const hit = (label) => {
    const b = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(x => x.textContent.indexOf(label) >= 0);
    if (!b) return null;
    b.click();
    return Array.from(document.querySelectorAll('#list .entry h3')).map(h => h.textContent);
  };
  const todo = hit('할 일');
  const untag = hit('분류 없음');
  hit('모든 기록');
  const all = document.querySelectorAll('#list .entry').length;
  return JSON.stringify({ todo, untag, all });
})()`));
check("«할 일» 은 안 끝낸 일이 남은 것만 모은다",
  (smartPick.todo || []).length === 1 && /할 일이 남은/.test((smartPick.todo || [])[0] || ""),
  (smartPick.todo || []).join(" · "));
check("«분류 없음» 은 태그 안 붙인 것만 모은다",
  (smartPick.untag || []).length === 1 && /태그 없는/.test((smartPick.untag || [])[0] || ""),
  (smartPick.untag || []).join(" · "));
check("«모든 기록» 으로 되돌아온다", smartPick.all === 4, smartPick.all + "편");

/* ⚠️ 지우기가 되돌릴 수 있어야 한다 · 십삼 년치를 담는 도구에서 되돌릴 수 없는 단추가
   카드마다 늘 나와 있으면 안 된다. 그리고 이때 드라이브 파일은 아직 안 건드린다. */
const trashFlow = JSON.parse(await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('#list .entry')).find(c => c.textContent.indexOf('수업 회고') >= 0);
  // 카드 단추는 제목 옆 ⋯ 안으로 들어갔다 · 열고 나서 눌러야 한다
  card.querySelector('.dots').click();
  const del = Array.from(document.querySelectorAll('.menupop button')).find(b => /삭제/.test(b.textContent));
  del.click();
  const gone = !Array.from(document.querySelectorAll('#list .entry')).some(c => c.textContent.indexOf('수업 회고') >= 0);
  const kept = JSON.parse(localStorage.getItem('pkos.entries.v2')).filter(x => x.id === 'v1')[0];
  const row = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('휴지통') >= 0);
  if (row) row.click();
  const inTrash = Array.from(document.querySelectorAll('#list .entry h3')).map(h => h.textContent);
  const back = Array.from(document.querySelectorAll('#list .entry button')).find(b => /되돌리기/.test(b.textContent));
  if (back) back.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  const all = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('모든 기록') >= 0);
  if (all) all.click();
  const restored = Array.from(document.querySelectorAll('#list .entry h3')).map(h => h.textContent);
  return JSON.stringify({ gone, kept: !!kept, trashed: kept && kept.trashed === true, inTrash, restored });
})()`));
check("지우면 목록에서 빠지되 데이터는 남는다", trashFlow.gone && trashFlow.kept && trashFlow.trashed,
  "남음 " + trashFlow.kept + " · 휴지통표시 " + trashFlow.trashed);
check("휴지통에서 지운 것을 찾는다", (trashFlow.inTrash || []).indexOf("수업 회고") >= 0,
  (trashFlow.inTrash || []).join(" · "));
check("되돌리면 제자리로 온다", (trashFlow.restored || []).indexOf("수업 회고") >= 0,
  (trashFlow.restored || []).join(" · "));

/* ---------- 10-8. 층을 만든다 · 자주 쓰는 것은 손 가까이, 가끔 쓰는 것은 한 겹 안으로 ----------
   단추를 «지운» 것이 아니다. 빈도와 상관없이 전부 같은 크기로 밖에 나와 있으면
   무엇을 눌러야 할지 매번 다시 찾게 된다. 그래서 층을 나눈다. */
const layered = JSON.parse(await evaluate(`(() => {
  const hdr = document.querySelector('.top-inner');
  const search = document.getElementById('search');
  const card = document.querySelector('.card.entry');
  return JSON.stringify({
    searchInHeader: !!(search && search.closest('header')),
    headerRows: hdr ? Math.round(hdr.getBoundingClientRect().height) : 0,
    titleIsButton: !!(card && card.querySelector('.titlebtn')),
    footButtons: card ? Array.from(card.querySelectorAll('.foot button')).map(b => b.textContent.trim()) : ['NO_CARD'],
    hasDots: !!(card && card.querySelector('.dots'))
  });
})()`));
check("검색이 머리띠로 올라왔다", layered.searchInHeader === true);
check("PC 에서 머리띠는 한 줄이다", layered.headerRows > 0 && layered.headerRows < 76, layered.headerRows + "px");
check("카드 제목을 누르면 열린다", layered.titleIsButton === true);
check("카드 바닥에 단추가 늘어서 있지 않다", (layered.footButtons || []).length === 0,
  (layered.footButtons || []).join(" · ") || "저장 상태만");
check("카드 단추는 제목 옆 ⋯ 안에 있다", layered.hasDots === true);

const popBehave = JSON.parse(await evaluate(`(() => {
  const card = document.querySelector('.card.entry');
  card.querySelector('.dots').click();
  const items = Array.from(document.querySelectorAll('.menupop button')).map(b => (b.firstChild || {}).textContent || '');
  const danger = !!document.querySelector('.menupop button.danger');
  return JSON.stringify({ items, danger });
})()`));
check("⋯ 안에 할 일이 다 들어 있다",
  ["📖 전체 보기", "✏️ 편집", "🔗 링크로 공유"].every(function (k) { return (popBehave.items || []).indexOf(k) >= 0; }),
  (popBehave.items || []).join(" · "));
/* ⚠️ 가장 위험한 일이 가장 어려워야 한다. 전에는 삭제가 편집 바로 옆에 늘 나와 있었다 */
check("삭제는 한 겹 안에서, 빨갛게 선다", popBehave.danger === true);
const popClose = await evaluate(`(async () => {
  await new Promise(r => setTimeout(r, 30));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return !document.querySelector('.menupop');
})()`);
check("Esc 를 누르면 ⋯ 가 닫힌다", popClose === true);

/* ---- 폰 · 모든 단추가 엄지에서 가장 먼 맨 위에 있으면 안 된다 ---- */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(700);
const dock = JSON.parse(await evaluate(`(() => {
  const d = document.getElementById('dock');
  if (!d) return JSON.stringify({ err: 'NO_DOCK' });
  const r = d.getBoundingClientRect();
  const labels = Array.from(d.querySelectorAll('.dockbtn .dl')).map(x => x.textContent);
  /* ⚠️ 바닥은 하나뿐이라 아래 바와 넣기 줄이 나눠 가질 수 없다.
     그래서 «때» 를 나눈다 · 쓰는 동안에는 넣기 줄이 바닥을 갖고 아래 바가 물러난다.
     여기서 보는 것은 «둘이 같이 서 있지 않은가» 다. */
  const writing = document.body.classList.contains('writing');
  const addbar = document.getElementById('addbar');
  const abShown = addbar ? getComputedStyle(addbar).display !== 'none' : false;
  const dockShown = getComputedStyle(d).display !== 'none';
  const ar = null;
  return JSON.stringify({
    shown: getComputedStyle(d).display !== 'none',
    atBottom: Math.abs(r.bottom - window.innerHeight) < 2,
    labels,
    writing, abShown, dockShown,
    overlapsAddbar: (writing && dockShown && abShown),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
  });
})()`));
check("폰에서 아래 고정 바가 선다", !dock.err && dock.shown && dock.atBottom, dock.err || (dock.labels || []).join(" · "));
check("폰은 «목록부터» 열린다", dock.writing === false, dock.writing ? "작성칸이 펴진 채 시작" : "목록부터");
check("아래 바에 매일 쓰는 넷이 있다", (dock.labels || []).length === 4, (dock.labels || []).join(" · "));
check("아래 바와 넣기 줄이 바닥을 다투지 않는다", dock.overlapsAddbar === false,
  "쓰는 중 " + dock.writing + " · 아래 바 " + dock.dockShown + " · 넣기 줄 " + dock.abShown);
check("아래 바를 넣어도 가로로 안 넘친다", dock.overflowX === 0, dock.overflowX + "px");
const dockWorks = JSON.parse(await evaluate(`(() => {
  document.getElementById('dockNav').click();
  const opened = document.getElementById('sideNav').classList.contains('open');
  document.getElementById('drawerScrim').click();
  document.getElementById('dockMore').click();
  const items = Array.from(document.querySelectorAll('.menupop button')).map(b => (b.firstChild || {}).textContent || '');
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return JSON.stringify({ opened, items });
})()`));
check("아래 바의 📂 가 폴더 서랍을 연다", dockWorks.opened === true);
check("아래 바의 ⋯ 에 나머지가 다 있다",
  ["🗂 폴더 구조", "🕸️ 관계망", "⚙️ 설정"].every(function (k) { return (dockWorks.items || []).indexOf(k) >= 0; }),
  (dockWorks.items || []).join(" · "));
await send("Emulation.clearDeviceMetricsOverride");
await wait(500);

/* ---------- 10-9. 양식과 집중 모드 ----------
   교사 기록은 「수업 회고」·「연수 정리」처럼 되풀이되는 것이 대부분이다.
   그때마다 소제목을 다시 치게 하면 결국 아무것도 안 적게 된다. */
await evaluate(`(() => {
  localStorage.setItem('pkos.entries.v2', '[]');
  ['pkos.draft.v1','pkos.desk.v1','pkos.deskList.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
/* ⚠️ ▾ 는 «이 기록을 어디에 둘까» 만 고르는 자리다. 양식 두 줄을 얹어 두었더니
   자리를 바꾸려고 연 사람 앞에 엉뚱한 줄이 먼저 섰다 · 양식은 아래 바 ⋯ 에 남겼다. */
const tpl = JSON.parse(await evaluate(`(() => {
  document.getElementById('topNewMore').click();
  const items = Array.from(document.querySelectorAll('.menupop button')).map(b => (b.firstChild || {}).textContent || '');
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  document.getElementById('dockMore').click();
  const one = Array.from(document.querySelectorAll('.menupop button')).find(b => b.textContent.indexOf('양식으로 시작') >= 0);
  const dockNote = one ? one.textContent.replace(/\s+/g, ' ').trim() : '';
  if (!one) return JSON.stringify({ err: 'NO_TEMPLATE', items });
  one.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  const heads = Array.from(document.querySelectorAll('#blocks .bhead')).map(h => h.textContent.replace(/[⠿▲▼✕]/g, '').trim());
  const first = (document.querySelector('#blocks input.inp') || {}).value || '';
  return JSON.stringify({
    items, dockNote, heads, first,
    type: (document.querySelector('#typeChips .chip.on') || {}).textContent || '',
    tags: document.getElementById('tags').value
  });
})()`));
check("＋ 새 기록 ▾ 는 «자리» 만 고른다 · 양식을 얹지 않는다",
  !tpl.err && !(tpl.items || []).some(function (t) { return /수업 회고|연수 정리/.test(t); }) &&
  (tpl.items || []).length === 3,
  (tpl.items || []).join(" · "));
check("양식은 아래 바 ⋯ 에 그대로 있다", /수업 회고/.test(tpl.dockNote || ""), tpl.dockNote || "");
check("양식이 소제목까지 세운 채로 열린다", (tpl.heads || []).length >= 5, (tpl.heads || []).join(" · "));
/* ⚠️ 새 갈래를 만들면 BLOCK_META 에도 적어야 한다. 안 적으면 이름표가 전부 「글」로 보인다 */
check("양식 안의 할 일이 «할 일» 로 선다", (tpl.heads || []).some(function (h) { return /할 일/.test(h); }),
  (tpl.heads || []).join(" · "));
check("양식이 유형과 태그도 같이 잡아 준다", /회고/.test(tpl.type || "") && /수업/.test(tpl.tags || ""),
  (tpl.type || "") + " / " + (tpl.tags || ""));
check("{날짜} 가 오늘 날짜로 바뀐다", /^\d{4}-\d{2}-\d{2}/.test(tpl.first || ""), tpl.first || "");

const focusMode = JSON.parse(await evaluate(`(() => {
  document.getElementById('btnFocus').click();
  const on = document.body.classList.contains('focusing');
  const hidden = ['header.top', '#sideNav', '#list'].map(sel => {
    const e = document.querySelector(sel);
    return e ? getComputedStyle(e).display : 'none';
  });
  const composer = getComputedStyle(document.getElementById('composer')).display;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const off = !document.body.classList.contains('focusing');
  return JSON.stringify({ on, hidden, composer, off });
})()`));
check("집중 모드가 옆의 것들을 감춘다",
  focusMode.on && (focusMode.hidden || []).every(function (d) { return d === "none"; }),
  (focusMode.hidden || []).join(" "));
check("집중 모드에서도 적는 칸은 남는다", focusMode.composer !== "none", focusMode.composer);
check("Esc 로 집중 모드에서 나온다", focusMode.off === true);

/* ---------- 10-10. 버린 것은 «어디에서도» 없는 것처럼 굴어야 한다 ----------
   휴지통을 만들면서 생기는 구멍이다. 목록에서만 빼고 끝내면 지운 기록이
   백링크로 남고, 관계망에 점으로 뜨고, 태그 숫자에 섞이고, 드라이브에 계속 올라간다.
   ⚠️ 그리고 «비우는 길» 이 없으면 버린 것이 색인에 영영 쌓인다. */
await evaluate(`(() => {
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    { id: 'z1', type: '', title: '살아있는 기록', tags: ['수업'],
      blocks: [{ id: 'b1', kind: 'text', text: '내용 [[사라질 기록]] 을 가리킴' }],
      relations: [], pinned: false, createdAt: 1755000000000, updatedAt: 1755000000000 },
    { id: 'z2', type: '', title: '사라질 기록', tags: ['수업', '버릴태그'],
      blocks: [{ id: 'b2', kind: 'text', text: '곧 버려질 내용' }],
      relations: [], pinned: false, createdAt: 1755000000000, updatedAt: 1755000000000 }
  ]));
  ['pkos.desk.v1','pkos.deskList.v1','pkos.draft.v1','pkos.sideOpen.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const buried = JSON.parse(await evaluate(`(() => {
  const byId = id => document.querySelector('#list .entry[data-eid="' + id + '"]');
  const chips = () => Array.from(document.querySelectorAll('#tagFilters .chip')).map(c => c.textContent.trim());
  const wiki = () => { const c = byId('z1'); const w = c && c.querySelector('.content .wikilink'); return w ? w.className : '없음'; };
  const before = { chips: chips(), wiki: wiki() };
  byId('z2').querySelector('.dots').click();
  Array.from(document.querySelectorAll('.menupop button')).find(b => /삭제/.test(b.textContent)).click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return JSON.stringify({ before, afterChips: chips(), afterWiki: wiki() });
})()`));
check("버린 기록의 태그가 칩에서 빠진다",
  !(buried.afterChips || []).some(function (c) { return /버릴태그/.test(c); }),
  (buried.afterChips || []).join(" "));
check("버린 기록으로 가던 [[연결]] 이 끊긴다", /missing/.test(buried.afterWiki || ""),
  (buried.before || {}).wiki + " → " + buried.afterWiki);
/* 관계망은 점을 그린다 · 「기록 N개」 라고 적어 두는 줄에서 센다.
   ⚠️ 그림은 setTimeout 뒤에 서므로 누르자마자 읽으면 아직 비어 있다 */
await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.vbtn')).find(x => (x.textContent||'').includes('관계망'));
  if (b) b.click();
  return true;
})()`);
await wait(900);
const inGraph = JSON.parse(await evaluate(`(() => {
  const bg = document.querySelector('.modal-bg');
  const all = bg ? bg.textContent : '';
  const m = all.match(/기록 ([0-9]+)개/);
  document.querySelectorAll('.modal-bg').forEach(x => x.remove());
  return JSON.stringify({ n: m ? +m[1] : -1, sample: all.slice(0, 90) });
})()`));
check("관계망에도 버린 기록이 안 뜬다", inGraph.n === 1, "점 " + inGraph.n + "개 · " + (inGraph.sample || ""));

/* 비우는 길 · 없으면 버린 것이 영영 쌓인다 */
const emptied = JSON.parse(await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('휴지통') >= 0);
  if (!row) return JSON.stringify({ err: 'NO_TRASH' });
  row.click();
  const bn = document.querySelector('#list .banner');
  const note = bn ? bn.textContent.replace(/\s+/g, ' ').trim() : '';
  const btn = bn && Array.from(bn.querySelectorAll('button')).find(b => /비우기/.test(b.textContent));
  if (!btn) return JSON.stringify({ err: 'NO_EMPTY_BTN', note });
  btn.click();
  const dlg = document.querySelector('.modal-bg .modal');
  const ask = dlg ? dlg.textContent.replace(/\s+/g, ' ').trim() : '';
  const yes = dlg && Array.from(dlg.querySelectorAll('button')).find(b => /모두 지우기/.test(b.textContent));
  if (yes) yes.click();
  const left = JSON.parse(localStorage.getItem('pkos.entries.v2')).map(n => n.title);
  return JSON.stringify({ note, ask, left });
})()`));
check("휴지통이 «드라이브는 아직 그대로» 를 말해 준다", /드라이브의 파일은 아직/.test(emptied.note || ""),
  (emptied.note || emptied.err || "").slice(0, 60));
check("휴지통을 비울 수 있다", !emptied.err && (emptied.left || []).length === 1,
  emptied.err || (emptied.left || []).join(" · "));
check("비우기 전에 한 번 더 묻는다", /되돌릴 수 없습니다/.test(emptied.ask || ""), (emptied.ask || "").slice(0, 50));

/* ---------- 10-11. 구역째로 접힌다 · 그리고 「＋ 새 기록」 이 진짜로 눌린다 ----------
   ⚠️ 태그가 곧 폴더인 사람은 폴더가 열댓 개다. 그런데 폴더 하나하나에는 자식이 없어서
      ▸ 손잡이가 안 붙는다 · 접을 길이 아예 없었다. 접는 것은 «칸마다» 가 아니라 «구역마다» 다.
   ⚠️ 그리고 접은 작성칸의 「＋ 새 기록」 은 «눈에는 보이는데 안 눌리는» 단추였다.
      클래스 이름을 collapsed 로 붙였더니, 이미 그 이름을 쓰던 «접힌 본문의 페이드»
      (.collapsed::after) 가 70px 짜리 투명 덮개를 단추 위에 얹었다.
      클래스 이름은 «무엇처럼 보이나» 가 아니라 «누가 이미 쓰고 있나» 로 정해야 한다. */
const sect = JSON.parse(await evaluate(`(() => {
  const cap = t => Array.from(document.querySelectorAll('#sideNav .sidecap')).find(c => c.textContent.indexOf(t) >= 0);
  const rows = () => document.querySelectorAll('#sideNav .siderow').length;
  const tags = () => document.querySelectorAll('#sideNav .tagrow').length;
  const f = cap('폴더 구조');
  if (!f) return JSON.stringify({ err: 'NO_CAP' });
  const before = rows();
  f.click();
  const closed = rows();
  cap('폴더 구조').click();
  const opened = rows();
  const t = cap('태그');
  let tBefore = tags(), tClosed = -1;
  if (t) { t.click(); tClosed = tags(); cap('태그').click(); }
  return JSON.stringify({ before, closed, opened, tBefore, tClosed,
    saved: localStorage.getItem('pkos.sideSec.v1') || '' });
})()`));
check("폴더 구역이 통째로 접힌다", !sect.err && sect.before > 0 && sect.closed === 0,
  sect.err || (sect.before + " → " + sect.closed));
check("다시 누르면 펴진다", sect.opened === sect.before, sect.closed + " → " + sect.opened);
check("태그 구역도 접힌다", sect.tClosed === 0, sect.tBefore + " → " + sect.tClosed);

await twoPane(); await wait(500);
/* 접힌 작성칸의 「＋ 새 기록」 을 «진짜 그 자리에서» 눌러 본다 ·
   프로그램으로 click() 을 부르면 덮개가 있어도 눌린다. 그래서 좌표로 확인한다. */
/* 쓰던 글(블록까지)이 있으면 일부러 안 접는다 · 빈 화면에서 봐야 한다 */
await evaluate(`(() => { localStorage.removeItem('pkos.draft.v1'); return true; })()`);
await send("Page.navigate", { url: URL_ });
await wait(2400);
const unfoldable = JSON.parse(await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('#sideNav .siderow'))[1];
  if (row) row.click();
  window.scrollTo(0, 0);
  const c = document.getElementById('composer');
  const b = document.getElementById('btnUnfold');
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return JSON.stringify({
    folded: c.classList.contains('cfolded'),
    reachable: !!hit && (hit === b || b.contains(hit)),
    hit: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '')) : 'null'
  });
})()`));
check("폴더를 누르면 작성칸이 접힌다(cfolded)", unfoldable.folded === true);
check("접힌 «＋ 새 기록» 이 무엇에도 안 덮인다", unfoldable.reachable === true,
  "그 자리의 요소 · " + unfoldable.hit);
await anyPane(); await wait(400);

/* ---------- 10-12. 3단 · 왼쪽 기둥 │ 가운데 목록 │ 오른쪽 편집 ----------
   업노트의 자리 나눔이다. 핵심은 «고르면 오른쪽에서 열린다» 하나다.
   ⚠️ 세 칸이 각자 굴러야 한다. 한 덩어리로 굴리면 목록을 훑는 동안 쓰던 칸이
      화면 밖으로 사라져서 «어디에 쓰고 있었지» 가 된다. */
await anyPane();
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
await evaluate(`(() => {
  const mk = (i, t) => ({ id: 'p' + i, type: '', title: t, tags: ['수업'],
    blocks: [{ id: 'b' + i, kind: 'text', text: t + ' 의 본문입니다. 두 줄까지만 미리 보입니다.' }],
    relations: [], pinned: false, createdAt: 1755000000000 - i * 8.64e7, updatedAt: 1755000000000 - i * 8.64e7 });
  localStorage.setItem('pkos.entries.v2', JSON.stringify([mk(0, '첫째 기록'), mk(1, '둘째 기록'), mk(2, '셋째 기록')]));
  /* ⚠️ ☰ 로 접어 둔 단은 기기에 남는다. 안 지우면 앞 점검이 접어 둔 채로
     여기 와서 «세 칸이 아니라 한 칸» 이라고 말한다 · 실제로 그랬다. */
  ['pkos.draft.v1','pkos.desk.v1','pkos.sideSec.v1','pkos.navStage.v1','pkos.sideFolded.v1']
    .forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const three = JSON.parse(await evaluate(`(() => {
  const cols = getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length;
  const lc = document.getElementById('listcol');
  const wr = document.querySelector('.layout > .wrap');
  const inList = lc ? lc.querySelectorAll('.entry').length : 0;
  const inWrap = wr ? wr.querySelectorAll('.entry').length : 0;
  return JSON.stringify({
    cols, inList, inWrap,
    listcolShown: lc ? getComputedStyle(lc).display !== 'none' : false,
    listScrolls: lc ? getComputedStyle(lc).overflowY : '',
    editScrolls: wr ? getComputedStyle(wr).overflowY : '',
    title: (document.getElementById('listTitle') || {}).textContent || '',
    composerInWrap: !!(wr && wr.querySelector('#composer'))
  });
})()`));
check("세 칸으로 갈린다", three.cols === 3 && three.listcolShown, three.cols + "칸");
check("기록 목록은 가운데 칸에 산다", three.inList > 0 && three.inWrap === 0,
  "가운데 " + three.inList + " · 오른쪽 " + three.inWrap);
check("쓰는 칸은 오른쪽에 산다", three.composerInWrap === true);
check("가운데와 오른쪽이 각자 구른다", three.listScrolls === "auto" && three.editScrolls === "auto",
  three.listScrolls + " / " + three.editScrolls);
check("가운데 칸 제목이 지금 보는 곳을 말한다", /모든 기록/.test(three.title), three.title);

/* ---------- 10-13. 좁은 칸에 «큰 것» 이 들어왔을 때 ----------
   ⚠️ 이 다섯은 236가지를 다 통과한 채로 깨져 있었다. 특히 삽입 미리보기는
      stillEmbed 를 그리는 반복문 «아래» 에 적어 두어 늘 undefined 로 그렸다.
      var 라 오류도 안 났다 · 눈으로만 보면 «고쳤는데 그대로» 로 보인다.
      그래서 여기서는 «클래스가 붙었나» 가 아니라 실제로 재서 말한다. */
await evaluate(`(() => {
  const mk = (i, t, blocks) => ({ id: 'e' + i, type: '', title: t, tags: ['수업'],
    blocks: blocks, relations: [], pinned: false,
    createdAt: 1755000000000 - i * 8.64e7, updatedAt: 1755000000000 - i * 8.64e7 });
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    /* ⚠️ 여기 안쪽은 «틀 문자열(template literal)» 안이다. 따옴표를 겹쳐 쓰면
       \' 가 그냥 ' 로 펴져서 넣는 순간 문법이 깨진다 · 겹따옴표를 아예 안 쓴다. */
    mk(0, '삽입이 붙은 기록', [{ id: 'x1', kind: 'embed', height: 360,
        code: '<h2>붙여 넣은 쪽</h2>' + '<p>아주 긴 내용입니다</p>'.repeat(40) }]),
    mk(1, '아주 긴 제목을 가진 기록입니다 · 한 줄에 안 들어가면 어디서 끊기는지 보려고 일부러 이렇게 길게 적어 둔 제목입니다', [{ id: 'x2', kind: 'text', text: '짧은 본문' }]),
    mk(2, '보통 기록', [{ id: 'x3', kind: 'text', text: '보통 본문입니다.' }])
  ]));
  ['pkos.draft.v1','pkos.desk.v1','pkos.navStage.v1','pkos.sideFolded.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const big = JSON.parse(await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.listcol .entry')];
  const box = document.querySelector('.embedbox');
  const frame = document.querySelector('.embedframe');
  const line = document.querySelector('.embedline');
  const h3 = cards[1] ? cards[1].querySelector('h3') : null;
  const wrap = document.querySelector('.layout > .wrap');
  return JSON.stringify({
    상자클래스: box ? box.className : '',
    상자보임: box ? getComputedStyle(box).display : '',
    틀굴림: frame ? frame.getAttribute('scrolling') : '',
    틀손: frame ? getComputedStyle(frame).pointerEvents : '',
    대신줄: line ? getComputedStyle(line).display : '없음',
    카드높이: cards.map(c => Math.round(c.getBoundingClientRect().height)),
    긴제목높이: h3 ? Math.round(h3.getBoundingClientRect().height) : 0,
    긴제목한줄: h3 ? Math.round(parseFloat(getComputedStyle(h3).lineHeight)) : 0,
    쓰는칸: Math.round(wrap.getBoundingClientRect().width),
    쓰는칸여백: Math.round(parseFloat(getComputedStyle(wrap).paddingLeft))
  });
})()`));
/* 카드 안 삽입은 «멈춘 그림» 이다 · 굴림도 손길도 없다 */
check("카드 안 삽입 페이지는 스스로 안 굴러간다",
  (big.상자클래스 || '').split(' ').indexOf('still') >= 0 && big.틀굴림 === "no" && big.틀손 === "none",
  big.상자클래스 + " · scrolling=" + big.틀굴림 + " · " + big.틀손);
/* 가운데 칸에서는 삽입 대신 한 줄 · 카드가 옆 카드보다 두 배가 되면 목록이 아니다 */
check("가운데 칸에서는 삽입이 한 줄로 접힌다",
  big.상자보임 === "none" && big.대신줄 === "block", big.상자보임 + " / " + big.대신줄);
check("카드 높이가 서로 고르다",
  Math.max(...big.카드높이) <= Math.min(...big.카드높이) * 1.5, big.카드높이.join(" · "));
/* 긴 제목은 두 줄에서 끊는다 · 미리보기가 두 줄이면 제목도 두 줄이다 */
check("긴 제목이 두 줄에서 끊긴다",
  big.긴제목한줄 > 0 && big.긴제목높이 <= big.긴제목한줄 * 2 + 2,
  big.긴제목높이 + "px · 한 줄 " + big.긴제목한줄 + "px");
/* ⚠️ 빈 자리를 없앤다고 칸을 다 줬더니 이번엔 글줄이 한 줄 217자가 됐다.
   읽기 좋은 줄은 45~90자다 · 칸은 그대로 두고 «줄» 에만 자를 댄다. */
check("넓은 화면에서도 글줄이 너무 안 길어진다",
  big.쓰는칸 - big.쓰는칸여백 * 2 <= 1010,
  "글 폭 " + (big.쓰는칸 - big.쓰는칸여백 * 2) + "px · 칸 " + big.쓰는칸 + "px");

/* ---------- 10-14. 세 칸이 안 되는 노트북(1021~1179px) ----------
   ⚠️ 목록을 위에 두었더니 글 한 줄 적으려고 목록을 1830px 지나쳐야 했다.
      게다가 작성칸을 위로 올리자 이번엔 기둥이 첫 줄 높이를 자기 키로 못 박아
      그 아래 634px 이 빈 판이 됐다 (grid-row: 1 / -1 은 여기서 한 줄로 접힌다).
      «위에 있나» 만 보지 말고 «사이가 비었나» 까지 같이 잰다. */
await send("Emulation.setDeviceMetricsOverride", { width: 1120, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL_ });
await wait(2500);
const two = JSON.parse(await evaluate(`(() => {
  const wrap = document.querySelector('.layout > .wrap');
  const list = document.querySelector('.listcol');
  const first = document.querySelector('.listcol .entry');
  const comp = document.getElementById('composer');
  const nav = document.getElementById('sideNav');
  return JSON.stringify({
    쓰는칸위: Math.round(wrap.getBoundingClientRect().top + scrollY),
    쓰는칸아래: Math.round(wrap.getBoundingClientRect().bottom + scrollY),
    목록위: Math.round(list.getBoundingClientRect().top + scrollY),
    첫기록까지: first ? Math.round(first.getBoundingClientRect().top + scrollY) : -1,
    작성칸높이: Math.round(comp.getBoundingClientRect().height),
    기둥줄: getComputedStyle(nav).gridRow
  });
})()`));
check("좁은 노트북에서 쓰는 자리가 목록 위에 온다", two.쓰는칸위 < two.목록위,
  "쓰는 자리 y" + two.쓰는칸위 + " · 목록 y" + two.목록위);
check("쓰는 자리와 목록 사이가 안 빈다", two.목록위 - two.쓰는칸아래 <= 8,
  "사이 " + (two.목록위 - two.쓰는칸아래) + "px · 기둥 " + two.기둥줄);
check("첫 기록까지 한 화면 안이다", two.첫기록까지 > 0 && two.첫기록까지 < 700,
  two.첫기록까지 + "px");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
await wait(400);

/* ---------- 10-15. 경계를 끄는 손잡이 · 글자 크기 ----------
   칸 너비는 사람마다 다르다. 끌 수 있게 해 두었으면 «끌린다·멈춘다·남는다·
   되돌아온다» 넷이 다 되어야 한다. 하나라도 빠지면 잘못 끈 사람이 갇힌다. */
await evaluate(`(() => { localStorage.removeItem('pkos.colW.v1'); localStorage.removeItem('pkos.navStage.v1'); return true; })()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const grip = JSON.parse(await evaluate(`(() => {
  const L = document.querySelector('.layout');
  const g = document.getElementById('gripNav');
  const g2 = document.getElementById('gripList');
  const cols = () => getComputedStyle(L).gridTemplateColumns.split(' ').map(v => Math.round(parseFloat(v)));
  const seen = (e) => getComputedStyle(e).display !== 'none';
  const drag = (el, dx, id) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 5, clientY: 400, button: 0, pointerId: id }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 5 + dx, clientY: 400, pointerId: id }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 5 + dx, clientY: 400, pointerId: id }));
  };
  const 처음 = cols();
  const 손잡이자리 = [Math.round(g.getBoundingClientRect().x), Math.round(g2.getBoundingClientRect().x)];
  const 보임 = [seen(g), seen(g2)];
  drag(g, 120, 11);
  const 끈뒤 = cols();
  const 남았나 = localStorage.getItem('pkos.colW.v1');
  drag(g, 2000, 12);
  const 최대 = cols();
  drag(g, -3000, 13);
  const 최소 = cols();
  g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const 되돌림 = cols();
  return JSON.stringify({ 처음, 손잡이자리, 보임, 끈뒤, 남았나, 최대, 최소, 되돌림 });
})()`));
check("경계에 손잡이가 둘 선다", grip.보임[0] === true && grip.보임[1] === true,
  "기둥 x" + grip.손잡이자리[0] + " · 목록 x" + grip.손잡이자리[1]);
check("손잡이가 칸 경계에 앉는다",
  Math.abs(grip.손잡이자리[0] - (grip.처음[0] - 5)) <= 1 &&
  Math.abs(grip.손잡이자리[1] - (grip.처음[0] + grip.처음[1] - 5)) <= 1,
  grip.손잡이자리.join(" / ") + " · 칸 " + grip.처음.join(" "));
check("끌면 칸 너비가 바뀐다", grip.끈뒤[0] === grip.처음[0] + 120,
  grip.처음[0] + " → " + grip.끈뒤[0]);
check("정한 너비가 기기에 남는다", !!grip.남았나 && grip.남았나.indexOf("nav") >= 0, String(grip.남았나));
/* ⚠️ 한계가 없으면 기둥을 화면 끝까지 끌어 목록과 쓰는 자리를 통째로 없앨 수 있다 */
check("한계에서 멈춘다 · 너무 넓지도 좁지도 않게",
  grip.최대[0] <= 460 && grip.최소[0] >= 180,
  "최대 " + grip.최대[0] + "px · 최소 " + grip.최소[0] + "px");
/* 잘못 끈 사람이 갇히면 안 된다 · 되돌릴 길이 있어야 한다 */
check("두 번 누르면 처음 너비로 돌아간다", grip.되돌림[0] === grip.처음[0],
  grip.최소[0] + " → " + grip.되돌림[0]);

/* ⚠️ 칸들이 «100vh - 66px» 로 못 박혀 있었다. 글자를 키우자 머리띠가 76px 이 되어
   칸이 화면보다 길어졌고, 쪽 전체에 굴림 막대가 서고 붙박이 자리도 어긋났다.
   머리띠 높이는 글자 크기·색감·너비를 따라 움직인다 · 재서 쓰는지 본다. */
const 재기 = JSON.parse(await evaluate(`(() => {
  const head = document.querySelector('header.top');
  const lc = document.querySelector('.listcol');
  const body = getComputedStyle(document.body);
  const h3 = document.querySelector('.listcol .entry h3');
  return JSON.stringify({
    머리띠: Math.round(head.getBoundingClientRect().height),
    알린값: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h'))),
    칸시작: Math.round(lc.getBoundingClientRect().y),
    쪽넘침: document.documentElement.scrollHeight - innerHeight,
    몸글: Math.round(parseFloat(body.fontSize)),
    몸글굵기: Number(body.fontWeight),
    제목굵기: h3 ? Number(getComputedStyle(h3).fontWeight) : 0
  });
})()`));
check("머리띠 높이를 재서 칸에 알려 준다", 재기.알린값 === 재기.머리띠 && 재기.칸시작 === 재기.머리띠,
  "머리띠 " + 재기.머리띠 + "px · 알린값 " + 재기.알린값 + "px · 칸 시작 " + 재기.칸시작);
check("칸이 화면보다 길어지지 않는다", 재기.쪽넘침 <= 1, "쪽 넘침 " + 재기.쪽넘침 + "px");
/* 가독성은 크기 하나로 오지 않는다 · 획도 같이 굵어야 한다 */
check("몸글이 크고 획이 굵다", 재기.몸글 >= 22 && 재기.몸글굵기 >= 600,
  재기.몸글 + "px / " + 재기.몸글굵기);
check("제목 획이 몸글보다 한 겹 굵다", 재기.제목굵기 > 재기.몸글굵기,
  재기.제목굵기 + " vs " + 재기.몸글굵기);

const picked = JSON.parse(await evaluate(`(() => {
  const t = document.querySelectorAll('#listcol .entry .titlebtn')[1];
  if (!t) return JSON.stringify({ err: 'NO_ITEM' });
  const name = t.textContent;
  t.click();
  const sel = document.querySelector('#listcol .entry.sel');
  return JSON.stringify({
    name,
    오른쪽제목: document.getElementById('title').value,
    표시됨: !!sel && sel.textContent.indexOf(name) >= 0,
    창이떴나: !!document.querySelector('.viewer')
  });
})()`));
check("고르면 오른쪽 칸에서 열린다", picked.오른쪽제목 === picked.name,
  (picked.err || picked.name + " → " + picked.오른쪽제목));
check("어느 줄을 열어 두었는지 목록에 표시된다", picked.표시됨 === true);
/* ⚠️ 3단에서 전체 보기 창이 뜨면 안 된다 · 오른쪽 칸이 이미 그 자리다 */
check("3단에서는 전체 보기 창이 안 뜬다", picked.창이떴나 === false);

const folded3 = await evaluate(`(() => {
  document.getElementById('title').value = '';
  const rows = document.querySelectorAll('#sideNav .siderow');
  if (rows[1]) rows[1].click();
  return document.getElementById('composer').classList.contains('cfolded');
})()`);
/* 3단에서는 접을 이유가 없다 · 목록이 이미 딴 칸에 서 있다 */
check("3단에서는 폴더를 눌러도 안 접힌다", folded3 === false);
await anyPane();
await wait(400);

/* ---------- 10-13. 폴더도 «하나하나» 접힌다 · 태그는 갈아탄다 · 폰은 굴리지 않는다 ----------
   ⚠️ 뿌리 줄에 hasKids 를 false 로 못 박아 두어서, 아래에 폴더가 열둘이나 매달려
      있어도 접기 손잡이가 안 붙었다. 구역만 접히고 폴더는 못 접었던 것이다. */
await evaluate(`(() => {
  const tags = ["부기","수업","질문","배움중심","바이브코딩","크롬 확장","자기관리","대학원","gpt","에듀테크","피캠스","pkos"];
  const list = tags.map((t, i) => ({ id: 'w' + i, type: '', title: t + ' 기록', tags: [t],
    blocks: [{ id: 'b' + i, kind: 'text', text: t }], relations: [], pinned: false,
    createdAt: 1755000000000, updatedAt: 1755000000000 }));
  localStorage.setItem('pkos.entries.v2', JSON.stringify(list));
  localStorage.setItem('pkos.settings.v1', JSON.stringify({ version: 1, folderMode: 'tag' }));
  ['pkos.desk.v1','pkos.deskList.v1','pkos.draft.v1','pkos.sideOpen.v1','pkos.sideSec.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const rootFold = JSON.parse(await evaluate(`(() => {
  const rows = () => Array.from(document.querySelectorAll('#sideNav .siderow')).map(r => (r.querySelector('.n') || {}).textContent);
  const tog = () => document.querySelector('#sideNav .siderow .sidetog:not(.none)');
  const before = rows();
  if (!tog()) return JSON.stringify({ err: 'NO_ROOT_TOGGLE', before });
  tog().click();
  const closed = rows();
  tog().click();
  return JSON.stringify({ before: before.length, closed, opened: rows().length });
})()`));
check("뿌리 폴더에도 접기 손잡이가 붙는다", !rootFold.err, rootFold.err || "붙음");
check("뿌리를 접으면 아래 폴더가 다 숨는다", (rootFold.closed || []).length === 1,
  (rootFold.closed || []).join(" · "));
check("다시 누르면 폴더가 돌아온다", rootFold.opened === rootFold.before,
  rootFold.before + " → " + rootFold.opened);

/* ⚠️ 기둥의 태그가 쌓이면 «모두 가진 기록» 만 남는다. 둘째 태그를 누른 순간
   「# 대학원 · 바이브코딩 0 / 9개 · 조건에 맞는 기록이 없습니다」 가 됐다. 갈아타야 한다. */
const tagSwap = JSON.parse(await evaluate(`(() => {
  const tag = n => Array.from(document.querySelectorAll('#sideNav .tagrow')).find(b => ((b.querySelector('.n') || {}).textContent) === n);
  const shown = () => document.querySelectorAll('#list .entry').length;
  const t1 = tag('대학원'), t2 = tag('바이브코딩');
  if (!t1 || !t2) return JSON.stringify({ err: 'NO_TAG' });
  t1.click();
  const a = { 제목: document.getElementById('listTitle').textContent, n: shown() };
  Array.from(document.querySelectorAll('#sideNav .tagrow')).find(b => ((b.querySelector('.n') || {}).textContent) === '바이브코딩').click();
  const b = { 제목: document.getElementById('listTitle').textContent, n: shown() };
  Array.from(document.querySelectorAll('#sideNav .tagrow')).find(b2 => ((b2.querySelector('.n') || {}).textContent) === '바이브코딩').click();
  const c = { 제목: document.getElementById('listTitle').textContent, n: shown() };
  return JSON.stringify({ a, b, c });
})()`));
check("기둥의 태그는 갈아탄다 (쌓이지 않는다)", !tagSwap.err && tagSwap.b.n === 1 && !/·/.test(tagSwap.b.제목),
  tagSwap.err || (tagSwap.a.제목 + " " + tagSwap.a.n + "개 → " + tagSwap.b.제목 + " " + tagSwap.b.n + "개"));
check("같은 태그를 다시 누르면 풀린다", tagSwap.c && tagSwap.c.n > 1, (tagSwap.c || {}).제목);

/* ⚠️ 폰에서 기록 한 편을 보기까지 700px 을 굴려야 했다 · 목록 «위» 가 넉 줄이었다 */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(700);
const phoneTop = JSON.parse(await evaluate(`(() => {
  const clr = Array.from(document.querySelectorAll('.filters .chip')).find(c => c.textContent.indexOf('필터 지우기') >= 0);
  if (clr) clr.click();
  const first = document.querySelector('#list .entry');
  return JSON.stringify({
    첫기록까지: first ? Math.round(first.getBoundingClientRect().top) : -1,
    보기줄: getComputedStyle(document.querySelector('.listcol .viewswitch')).display,
    엮어내기: getComputedStyle(document.getElementById('btnCompile')).display,
    태그칩: getComputedStyle(document.getElementById('tagFilters')).display,
    유형칩줄: getComputedStyle(document.getElementById('typeFilters')).flexWrap
  });
})()`));
check("폰에서 첫 기록이 한 화면 안에 든다", phoneTop.첫기록까지 > 0 && phoneTop.첫기록까지 < 500,
  phoneTop.첫기록까지 + "px");
check("폰에서 보기 줄·엮어내기는 아래 바 ⋯ 로 간다",
  phoneTop.보기줄 === "none" && phoneTop.엮어내기 === "none");
check("폰에서 태그 칩은 서랍에 맡긴다", phoneTop.태그칩 === "none");
check("폰에서 유형 칩은 한 줄로 민다", phoneTop.유형칩줄 === "nowrap", phoneTop.유형칩줄);
const dockView = JSON.parse(await evaluate(`(() => {
  document.getElementById('dockMore').click();
  const items = Array.from(document.querySelectorAll('.menupop button')).map(b => (b.firstChild || {}).textContent || '');
  const v = Array.from(document.querySelectorAll('.menupop button')).find(b => /보기 바꾸기/.test(b.textContent));
  const before = JSON.parse(localStorage.getItem('pkos.settings.v1')).viewMode || 'stream';
  if (v) v.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return JSON.stringify({ items, before, after: JSON.parse(localStorage.getItem('pkos.settings.v1')).viewMode });
})()`));
check("아래 바 ⋯ 에서 보기를 바꿀 수 있다", dockView.before !== dockView.after,
  dockView.before + " → " + dockView.after);
await anyPane();
await wait(400);

/* ---------- 10-14. 자리를 먼저 정하고 이름을 붙인다 · 안 보이는 것은 눈에 보이게 ----------
   ⚠️ 이 앱에서 첫 태그는 그냥 딱지가 아니라 «폴더 이름» 이고, 파일 이름도 그것으로 시작한다.
      제목부터 적게 해 두면 자리를 정하기 전에 이름부터 짓게 되어,
      「배움」 을 제목으로 「질문」 을 태그로 적고 나서 왜 폴더가 따로 생겼는지 모르게 된다. */
await evaluate(`(() => {
  localStorage.setItem('pkos.entries.v2', JSON.stringify([
    { id: 'n1', type: 'idea', title: '사라진 기록', tags: ['pkos'], mdId: 'MDX',
      blocks: [{ id: 'b1', kind: 'text', text: '내용' }], relations: [], pinned: false,
      createdAt: 1755000000000, updatedAt: 1755000000000, _missing: true },
    { id: 'n2', type: '', title: '멀쩡한 기록', tags: ['수업'],
      blocks: [{ id: 'b2', kind: 'text', text: '내용' }], relations: [], pinned: false,
      createdAt: 1755000000000, updatedAt: 1755000000000 }
  ]));
  localStorage.setItem('pkos.settings.v1', JSON.stringify({ version: 1, folderMode: 'tag' }));
  ['pkos.desk.v1','pkos.draft.v1','pkos.sideSec.v1','pkos.sideOpen.v1'].forEach(k => localStorage.removeItem(k));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const nameOrder = JSON.parse(await evaluate(`(() => {
  const labels = Array.from(document.querySelectorAll('#composer .grid2 .field label')).map(l => l.textContent.trim());
  const g = document.getElementById('tags'); g.value = '배움중심, 질문'; g.dispatchEvent(new Event('input', { bubbles: true }));
  const t = document.getElementById('title'); t.value = '평가에 관한 논의'; t.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({ labels, hint: (document.getElementById('nameHint') || {}).textContent || '' });
})()`));
check("태그 칸이 제목보다 먼저 온다", /태그/.test((nameOrder.labels || [])[0] || ""), (nameOrder.labels || []).join(" → "));
check("첫 태그가 폴더가 된다고 그 자리에서 말한다", /폴더/.test((nameOrder.labels || [])[0] || ""),
  (nameOrder.labels || [])[0] || "");
/* 저장하고 드라이브를 열어 봐야 아는 것은 늦다 · 적는 그 자리에서 이름을 보여 준다 */
check("파일 이름이 «폴더명_제목» 으로 미리 보인다",
  /배움중심_평가에 관한 논의\.md/.test(nameOrder.hint || ""), nameOrder.hint || "(안 보임)");

/* ⚠️ «안 보인다» 고 색인에서 저절로 지우면 안 된다. drive.file 에서 «안 보인다» 는
   «지워졌다» 가 아니라 «권한이 끊겼다» 일 수도 있다. 저절로 지우면 권한이 잠깐
   흔들린 날 십삼 년치가 통째로 사라진다. 대신 눈에 보이게 하고 사람이 치우게 한다. */
const goneMark = JSON.parse(await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#sideNav .siderow')).map(r => ({
    n: (r.querySelector('.n') || {}).textContent, gone: r.classList.contains('gone')
  }));
  const card = Array.from(document.querySelectorAll('#list .entry')).find(c => c.textContent.indexOf('안 보입니다') >= 0);
  const btns = card ? Array.from(card.querySelectorAll('.banner button')).map(b => b.textContent.trim()) : [];
  return JSON.stringify({ rows, btns });
})()`));
check("안 보이는 기록만 든 폴더는 흐리게 선다",
  (goneMark.rows || []).some(function (r) { return r.n === "pkos" && r.gone; }),
  (goneMark.rows || []).map(function (r) { return r.n + (r.gone ? "(흐림)" : ""); }).join(" · "));
check("멀쩡한 폴더는 그대로 선다",
  (goneMark.rows || []).some(function (r) { return r.n === "수업" && !r.gone; }));
check("안 보이는 기록을 손으로 치울 수 있다",
  (goneMark.btns || []).some(function (t) { return /치우기/.test(t); }),
  (goneMark.btns || []).join(" · "));

/* 빈 화면의 긴 설명도 걷어냈다 · 그 글이 돌아오면 안 된다 */
const oldEmptyDesc = await evaluate(`/마크다운\\(.md\\)으로, 사진·파일은 정리된 이름/.test(document.body.textContent)`);
check("빈 화면의 긴 설명이 돌아오지 않았다", !oldEmptyDesc);

/* 폰 너비로 줄여 서랍을 겪어 본다 · CSS 는 창 너비에 바로 반응한다 */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(600);
const drawer = JSON.parse(await evaluate(`(() => {
  const nav = document.getElementById('sideNav');
  const btn = document.getElementById('btnDrawer');
  const before = getComputedStyle(nav).transform;
  const shown = getComputedStyle(btn).display;
  btn.click();
  const opened = nav.classList.contains('open');
  const scrim = getComputedStyle(document.getElementById('drawerScrim')).display;
  document.getElementById('drawerScrim').click();
  const closed = !nav.classList.contains('open');
  return JSON.stringify({ hidden: before !== 'none', shown, opened, scrim, closed });
})()`));
check("폰에서는 기둥이 서랍으로 숨는다", drawer.hidden, drawer.hidden ? "숨음" : "그대로 보임");
check("줄 셋(☰)이 보이고 누르면 서랍이 열린다", drawer.shown !== "none" && drawer.opened && drawer.scrim === "block",
  `줄셋 ${drawer.shown} · 열림 ${drawer.opened}`);
check("바깥을 누르면 닫힌다", drawer.closed);
/* ⚠️ 손가락은 화살표가 아니다. 길찾기 줄이 19px, 태그가 26px 이었다 ·
   옆줄이 눌리거나 아무것도 안 눌린다. 글자는 그대로 두고 누를 자리만 넓혔다. */
const thumb = JSON.parse(await evaluate(`(() => {
  const small = [...document.querySelectorAll('#list .crumb, #list .tag.pick, #list .pinbtn, #list .dots')]
    .map(e => { const r = e.getBoundingClientRect();
      return { 누가: (e.className || '').split(/\s+/)[0], 높이: Math.round(r.height) }; })
    .filter(x => x.높이 > 0 && x.높이 < 32);
  return JSON.stringify({ small });
})()`));
check("폰에서 누를 자리가 32px 아래로 안 내려간다", (thumb.small || []).length === 0,
  (thumb.small || []).map(x => x.누가 + " " + x.높이 + "px").join(" · ") || "다 34px 이상");
await send("Emulation.clearDeviceMetricsOverride");
await wait(500);

/* ---------- 11. 끝난 뒤에도 오류가 없어야 한다 ---------- */
check("끝까지 오류 없음", errors.length === 0 && logs.length === 0, [...errors, ...logs][0] || "");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
