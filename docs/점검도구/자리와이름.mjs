/* 자리와 이름 · 사람이 드라이브에서 «옮기고 바꾸고 버릴» 때 앱이 어떻게 구는지 본다.

   앱과 드라이브 폴더 사이에서 어긋나는 것은 대개 «내용» 이 아니라 «자리와 이름» 이다.
   파일 하나를 다른 폴더로 끌어다 놓았을 뿐인데 길찾기 줄이 옛 자리를 가리키거나,
   드라이브에서 붙여 준 이름을 앱이 조용히 되돌려 놓거나, 아예 안 열리거나.

   그래서 여기서는 가짜 드라이브가 «진짜로» 움직인다.
   옮기라면 폴더 표에서 옮기고, 이름을 바꾸라면 바꾸고, 버리라면 버린다.
   그 위에서 열 가지 상황을 차례로 겪어 본다.

   설치할 것 없음: 노드에 들어 있는 WebSocket 만 쓴다.
   실행:  node docs/점검도구/자리와이름.mjs [url]
   --------------------------------------------------------- */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const URL_ = (process.argv[2] || "http://localhost:8000/").replace(/\/?$/, "/");
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

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "pkos-place-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,900", URL_,
], { stdio: "ignore" });
/* ⚠️ 끝에서만 edge.kill() 을 부르면 도중에 넘어졌을 때 브라우저가 살아 남는다.
   나가는 «모든» 길에서 끄도록 여기서 한 번에 걸어 둔다. */
process.on("exit", () => { try { edge.kill(); } catch {} });
["SIGINT", "SIGTERM"].forEach((sig) =>
  process.on(sig, () => { try { edge.kill(); } catch {} process.exit(130); }));

const results = [];
const errors = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " · " + detail : ""}`);
}

/* ---------------------------------------------------------
   가짜 드라이브 · 작게, 그러나 «진짜로 움직이게»

   ROOT 내 폴더/
    ├ 2019/ 과학/
    │    ├ 물의 상태변화 학습지.hwp
    │    └ 수업사진.jpg
    └ 연수/
         └ 2019-05-02_경험_연수 다녀옴.md
   --------------------------------------------------------- */
const FAKE = `(function () {
  if (!sessionStorage.getItem('keep')) localStorage.clear();
  localStorage.setItem('pkos.connected', '1');
  localStorage.setItem('pkos.folder', JSON.stringify({ id: 'ROOT', name: '내 폴더', link: '' }));
  localStorage.setItem('pkos.token.v1', JSON.stringify({ t: 'FAKE', exp: Date.now() + 3600000 }));
  localStorage.setItem('pkos.email', 'teacher@example.com');

  var FOLDER = 'application/vnd.google-apps.folder';
  function f(id, name, mime) {
    return { id: id, name: name, mimeType: mime, size: '1234', trashed: false,
      createdTime: '2019-03-02T01:00:00.000Z', modifiedTime: '2020-06-01T01:00:00.000Z' };
  }
  // 파일 하나하나를 id 로 들고, 어느 폴더에 있는지는 parent 로 적는다. 진짜 드라이브와 같은 모양이다
  var FILES = {
    D2019:  f('D2019', '2019', FOLDER),
    DSCI:   f('DSCI', '과학', FOLDER),
    DYEONSU:f('DYEONSU', '연수', FOLDER),
    H1:     f('H1', '물의 상태변화 학습지.hwp', 'application/octet-stream'),
    P1:     f('P1', '수업사진.jpg', 'image/jpeg'),
    MD1:    f('MD1', '2019-05-02_경험_연수 다녀옴.md', 'text/markdown')
  };
  var PARENT = { D2019: 'ROOT', DSCI: 'D2019', DYEONSU: 'ROOT', H1: 'DSCI', P1: 'DSCI', MD1: 'DYEONSU' };

  /* id 가 적힌 .md · 앱이 쓴 글을 다른 기기에서 가져온 모양이다.
     이게 있어야 «지웠다가 다시 가져오기» 에서 지운 표시(tombstone)와 부딪히는 자리를 겪어 볼 수 있다. */
  var MD1TEXT = ['---','id: k_yeonsu1','title: 연수 다녀옴','type: 경험','tags: [연수]','---','',
                 '# 연수 다녀옴','','오늘 연수를 다녀왔다.',''].join('\\n');
  var PNG8 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOo6FmAFTEMLQkA/SBpAUsyaigAAAAASUVORK5CYII=';

  /* 점검이 «사람 노릇» 을 할 수 있게 손잡이를 밖으로 낸다.
     여기서 부르는 것은 전부 «사람이 드라이브에서 하는 일» 이다. 앱은 이걸 못 본다. */
  window.__drive = {
    files: FILES, parent: PARENT,
    moved: [], renamed: [], trashed: [], created: [],
    move: function (id, to) { PARENT[id] = to; },
    rename: function (id, name) { FILES[id].name = name; },
    trash: function (id) { FILES[id].trashed = true; },
    untrash: function (id) { FILES[id].trashed = false; },
    nameOf: function (id) { return FILES[id] ? FILES[id].name : null; },
    parentOf: function (id) { return PARENT[id] || null; },
    reset: function () { window.__drive.moved = []; window.__drive.renamed = []; window.__drive.trashed = []; }
  };

  function kids(pid) {
    var out = [];
    for (var id in PARENT) if (PARENT[id] === pid && !FILES[id].trashed) out.push(FILES[id]);
    return out;
  }
  function J(o) {
    return Promise.resolve(new Response(JSON.stringify(o),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('googleapis.com') < 0) return realFetch(url, opts);
    var method = (opts && opts.method) || 'GET';
    if (u.indexOf('/userinfo') >= 0) return J({ email: 'teacher@example.com' });

    if (method !== 'GET') {
      var body = String((opts && opts.body) || '');
      var who = (/files\\/([\\w-]+)/.exec(u) || ['', ''])[1];
      // ① 올리기 · 새 파일이면 진짜로 만든다
      if (u.indexOf('/upload/') >= 0) {
        var nm = (/"name"\\s*:\\s*"([^"]*)"/.exec(body) || ['', ''])[1];
        if (who) {
          // 이미 있는 파일 덮어쓰기. 이름을 함께 보냈으면 «이름을 바꾼 것» 이다
          if (/"name"\\s*:/.test(body)) {
            window.__drive.renamed.push({ id: who, name: nm });
            if (FILES[who]) FILES[who].name = nm;
          }
          return J({ id: who, name: FILES[who] ? FILES[who].name : nm });
        }
        var pid = (/"parents"\\s*:\\s*\\["([^"]*)"\\]/.exec(body) || ['', 'ROOT'])[1];
        var nid = 'NEW' + (window.__drive.created.length + 1);
        FILES[nid] = f(nid, nm || '무제', 'text/markdown');
        PARENT[nid] = pid;
        window.__drive.created.push({ id: nid, name: nm, parent: pid });
        return J({ id: nid, name: nm });
      }
      // ② 폴더 만들기
      if (/"mimeType"\\s*:\\s*"application\\/vnd.google-apps.folder"/.test(body)) {
        var fn = (/"name"\\s*:\\s*"([^"]*)"/.exec(body) || ['', '새 폴더'])[1];
        var fp = (/"parents"\\s*:\\s*\\["([^"]*)"\\]/.exec(body) || ['', 'ROOT'])[1];
        var fid = 'F' + (window.__drive.created.length + 1) + Math.floor(Math.random() * 1000);
        FILES[fid] = f(fid, fn, FOLDER); PARENT[fid] = fp;
        window.__drive.created.push({ id: fid, name: fn, parent: fp });
        return J({ id: fid, name: fn });
      }
      // ③ 버리기 · 옮기기 · 이름 바꾸기 · 전부 진짜로 반영한다
      if (/"trashed"\\s*:\\s*true/.test(body)) {
        window.__drive.trashed.push(who);
        if (FILES[who]) FILES[who].trashed = true;
        return J({ id: who });
      }
      if (u.indexOf('addParents=') >= 0) {
        var to = (/addParents=([^&]*)/.exec(u) || ['', ''])[1];
        window.__drive.moved.push({ id: who, to: to });
        if (FILES[who]) PARENT[who] = to;
        return J({ id: who });
      }
      if (/"name"\\s*:/.test(body)) {
        var rn = (/"name"\\s*:\\s*"([^"]*)"/.exec(body) || ['', ''])[1];
        window.__drive.renamed.push({ id: who, name: rn });
        if (FILES[who]) FILES[who].name = rn;
        return J({ id: who, name: rn });
      }
      return J({ id: who || 'OK' });
    }

    if (u.indexOf('alt=media') >= 0) {
      var mm = /files\\/([\\w-]+)\\?/.exec(u);
      var w2 = mm ? mm[1] : '';
      if (w2 === 'MD1') return Promise.resolve(new Response(MD1TEXT, { status: 200 }));
      var bin = atob(PNG8), arr = new Uint8Array(bin.length);
      for (var bi = 0; bi < bin.length; bi++) arr[bi] = bin.charCodeAt(bi);
      return Promise.resolve(new Response(arr, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    }
    if (u.indexOf('/files?') < 0) {
      var mv = /files\\/([\\w-]+)\\?/.exec(u);
      var fid2 = mv ? mv[1] : 'ROOT';
      if (fid2 === 'ROOT') return J({ id: 'ROOT', name: '내 폴더', mimeType: FOLDER });
      if (!FILES[fid2] || FILES[fid2].trashed) {
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }));
      }
      var one = FILES[fid2];
      return J({ id: one.id, name: one.name, mimeType: one.mimeType, parents: [PARENT[fid2]] });
    }
    var q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || ['', ''])[1]);
    if (q.indexOf('name=') >= 0 || q.indexOf('name contains') >= 0) return J({ files: [] });
    var mp = /'([\\w-]+)' in parents/.exec(q);
    if (!mp) return J({ files: [] });
    return J({ files: kids(mp[1]) });
  };
})()`;

/* ---------------- CDP ---------------- */
let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

let u;
for (let i = 0; i < 60 && !u; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    u = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  } catch {}
  if (!u) await wait(250);
}
if (!u) { console.error("브라우저에 못 붙었습니다."); edge.kill(); process.exit(3); }
ws = new WebSocket(u);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result); return;
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE });
await send("Page.reload");
await wait(2600);

/* ---------------- 사람 노릇 하는 손 ---------------- */
const closeModals = () => ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);

async function runImport() {
  await closeModals();
  await ev(`document.getElementById('btnSettings').click(); true`);
  await wait(400);
  await ev(`(() => {
    const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => (x.textContent||'').includes('가져오기'));
    if (t) t.click(); return true;
  })()`);
  await wait(350);
  const pressed = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('폴더 훑어서 가져오기'));
    if (!b) return 'NO_BUTTON';
    if (b.disabled) return 'DISABLED';
    b.click(); return 'CLICKED';
  })()`);
  // 자료를 물어보면 «가져오기» 로 답한다 (안 물어보면 새로 들어올 것이 없다는 뜻)
  for (let i = 0; i < 30; i++) {
    await wait(400);
    const asked = await ev(`(() => {
      const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('자료도 함께'));
      if (!m) return false;
      const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent === '가져오기');
      if (b) b.click();
      return true;
    })()`);
    if (asked) break;
    const done = await ev(`(() => {
      const s = Array.from(document.querySelectorAll('.mbody')).map(x => x.textContent).join(' ');
      return /훑었습니다|가져왔습니다|색인에 넣었습니다/.test(s);
    })()`);
    if (done) break;
  }
  await wait(2200);
  await closeModals();
  await wait(300);
  return pressed;
}

/* 카드의 «✏️ 편집» 은 화면 맨 위 «쓰는 자리» 로 기록을 올려 놓는다.
   저장 단추는 그때 이름이 «수정 저장» 으로 바뀐다. */
/* 카드의 «✏️ 편집» 은 화면 맨 위 «쓰는 자리» 로 기록을 올려 놓는다.
   저장 단추는 그때 이름이 «수정 저장» 으로 바뀐다. */
const openEditor = () => ev(`(() => {
  const c = document.querySelector('.card.entry');
  if (!c) return 'NO_CARD';
  /* ⚠️ 카드 단추는 제목 옆 ⋯ 안으로 들어갔다 · 열고 나서 눌러야 한다 */
  const __d = c.querySelector('.dots'); if (__d) __d.click();
  const b = Array.from(document.querySelectorAll('.menupop button')).find(x => (x.textContent||'').includes('편집'));
  if (!b) return 'NO_EDIT[' + Array.from(c.querySelectorAll('button')).map(x => x.textContent).join('|') + ']';
  b.click(); return 'OPEN';
})()`);
const pressSave = () => ev(`(() => {
  const b = document.getElementById('btnSave');
  if (!b || b.disabled) return 'NO_SAVE';
  b.click(); return 'SAVED';
})()`);
const entryBy = (srcId) => ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  const e = L.find(x => x.srcId === '${srcId}' || x.mdId === '${srcId}');
  return JSON.stringify(e ? { id: e.id, title: e.title, path: e.srcPath || [], mdId: e.mdId || '', mdName: e.mdName || '' } : null);
})()`).then((s) => JSON.parse(s));

const setSearch = (text) => ev(
  "(() => { const q = document.getElementById('search'); q.value = " + JSON.stringify(text) +
  "; q.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
/* 목록에서 그 한 편만 남기고 본다. 카드가 안 그려지면 «안 보임» 알림도 안 그려진다 */
const crumbOf = async (title) => {
  await setSearch('');
  await wait(200);
  await setSearch(title);
  await wait(700);
  return ev(`(() => {
    const cards = Array.from(document.querySelectorAll('.card.entry'));
    return JSON.stringify({
      crumbs: cards.map(c => Array.from(c.querySelectorAll('.crumb')).map(x => x.textContent).join('/')).join(' | '),
      gone: document.querySelectorAll('.banner.gone').length,
      cards: cards.length
    });
  })()`).then((x) => JSON.parse(x));
};

/* =========================================================
   상황 ⓪ · 먼저 십삼 년치를 끌어온다
   ========================================================= */
const first = await runImport();
check("① 폴더를 훑어 가져온다", first === "CLICKED", String(first));
const hwp0 = await entryBy("H1");
check("① 거쳐 온 길이 그대로 적힌다", !!hwp0 && hwp0.path.join("/") === "2019/과학",
  hwp0 ? hwp0.path.join(" › ") : "기록이 안 섰다");
const md0 = await entryBy("MD1");
/* 앱이 제 살림으로 쓰는 파일(색인·설정·색인 조각)이 «자료» 로 들어오면,
   폴더를 훑을 때마다 내가 안 넣은 기록이 목록에 하나씩 는다. */
const mine = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  return L.filter(e => /PKOS-index|PKOS-settings/.test(e.title || '')).length;
})()`);
check("① 앱이 만든 색인·설정은 기록으로 안 들어온다", mine === 0, mine + "편 들어옴");
/* 왼쪽 기둥 · 접힘. 기본은 뿌리 바로 아래만 보이고, ▸ 를 눌러 편다.
   폴더가 수십이 되면 접히지 않는 기둥은 기둥이 아니라 벽이다. */
const sideFold = await ev(`(() => {
  const names = () => Array.from(document.querySelectorAll('#sideNav .siderow .n')).map(x => x.textContent);
  const before = names();
  const find = (nm) => Array.from(document.querySelectorAll('#sideNav .siderow'))
    .find(x => (x.querySelector('.n')||{}).textContent === nm);
  const r2019 = find('2019');
  if (!r2019) return JSON.stringify({ err: 'NO_2019', before });
  const tog = r2019.querySelector('.sidetog');
  if (!tog || tog.classList.contains('none')) return JSON.stringify({ err: 'NO_TOG', before });
  tog.click();
  const opened = names();
  const tog2 = find('2019').querySelector('.sidetog');
  tog2.click();
  const closed = names();
  return JSON.stringify({ before, opened, closed });
})()`).then((x) => JSON.parse(x));
/* ⚠️ 처음부터 «두 겹» 은 펴 둔다. 접힌 지도는 지도 구실을 못 한다 ·
   「2019 · 3」 만 보이고 안이 안 보이면 무엇이 들었는지 알 길이 없어서 결국 아무도 안 편다.
   그래서 첫 번째 누름이 «접기» 이고 두 번째가 «펴기» 다. */
check("① 기둥은 두 겹까지 펴진 채로 시작한다", !sideFold.err && sideFold.before.indexOf("과학") >= 0,
  sideFold.err || sideFold.before.join(" · "));
check("① ▾ 를 누르면 접힌다", !sideFold.err && sideFold.opened.indexOf("과학") < 0,
  (sideFold.opened || []).join(" · "));
check("① 다시 누르면 펴진다", !sideFold.err && sideFold.closed.indexOf("과학") >= 0,
  (sideFold.closed || []).join(" · "));


check("① 글(.md)은 안을 읽어 되살린다", !!md0 && md0.title === "연수 다녀옴", md0 ? md0.title : "없음");

/* =========================================================
   상황 ② · 사람이 파일을 다른 폴더로 끌어다 놓는다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.move('H1', 'DYEONSU'); true`);
await runImport();
const hwp1 = await entryBy("H1");
check("② 옮기면 앱이 그 자리를 따라온다", !!hwp1 && hwp1.path.join("/") === "연수",
  hwp1 ? hwp1.path.join(" › ") || "(뿌리)" : "없음");
const moved1 = await ev(`JSON.stringify(window.__drive.moved)`);
check("② 따라오면서 원본을 되돌려 놓지 않는다", moved1 === "[]", moved1);

/* =========================================================
   상황 ③ · 사람이 폴더 이름을 바꾼다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.rename('DYEONSU', '2019 연수'); true`);
await runImport();
const hwp2 = await entryBy("H1");
check("③ 폴더 이름을 바꾸면 길도 새 이름이 된다", !!hwp2 && hwp2.path.join("/") === "2019 연수",
  hwp2 ? hwp2.path.join(" › ") : "없음");

/* =========================================================
   상황 ④ · 사람이 폴더를 통째로 다른 폴더 안으로 옮긴다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.move('DYEONSU', 'D2019'); true`);
await runImport();
const hwp3 = await entryBy("H1");
check("④ 폴더째 옮기면 그 안의 것도 다 따라온다", !!hwp3 && hwp3.path.join("/") === "2019/2019 연수",
  hwp3 ? hwp3.path.join(" › ") : "없음");

/* =========================================================
   상황 ⑤ · 사람이 드라이브에서 파일 이름을 바꾼다
   앱이 제 이름으로 되돌려 놓으면, 사람이 붙인 이름이 사라진다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.rename('MD1', '연수 정리본.md'); true`);
await runImport();
// 그 기록을 한 번 고쳐 저장시킨다 · 저장이 이름을 되돌리는지 보는 자리다
await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  return L.length;
})()`);
await setSearch('연수 다녀옴');
await wait(700);
const edited = await openEditor();
await wait(900);
const saved = await pressSave();
await wait(3000);
await closeModals();
const renamed5 = await ev(`JSON.stringify(window.__drive.renamed)`);
const nameNow = await ev(`window.__drive.nameOf('MD1')`);
check("⑤ 고쳐 놓은 기록을 열어 저장할 수 있다", edited === "OPEN" && saved === "SAVED", `${edited} / ${saved}`);
check("⑤ 드라이브에서 바꾼 이름을 앱이 되돌리지 않는다", nameNow === "연수 정리본.md",
  `지금 이름: ${nameNow} · 바꾼 기록 ${renamed5}`);

/* =========================================================
   상황 ⑥ · 앱에서 제목을 바꿔도, 밖에서 온 원본 이름은 사람 것이다
   («앱이 만든 것» 과 «밖에서 온 것» 을 가르는 자리다. 자리 규칙과 같다)
   ========================================================= */
await ev(`window.__drive.reset(); true`);
const retitled = await openEditor();
await wait(900);
await ev(`(() => {
  const t = document.getElementById('title');
  if (!t) return false;
  t.value = '연수 다녀와서 남긴 것';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await wait(300);
await pressSave();
await wait(3000);
await closeModals();
const nameAfterTitle = await ev(`window.__drive.nameOf('MD1')`);
check("⑥ 제목을 바꿔도 밖에서 온 원본 이름은 그대로다",
  retitled === "OPEN" && nameAfterTitle === "연수 정리본.md",
  `지금 이름: ${nameAfterTitle}`);

/* =========================================================
   상황 ⑥-2 · 앱이 «만든» 기록은 이름 규칙을 따라야 한다
   («안 건드린다» 가 «영영 안 바꾼다» 가 되면, 이름 규칙 기능이 죽는다)
   ========================================================= */
await ev(`window.__drive.reset(); true`);
await setSearch('');
await wait(400);
const wrote = await ev(`(() => {
  document.getElementById('title').value = '앱에서 새로 쓴 것';
  document.getElementById('title').dispatchEvent(new Event('input', { bubbles: true }));
  const ta = document.querySelector('#blocks textarea, .block textarea, textarea');
  if (ta) { ta.value = '본문 한 줄.'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  const b = document.getElementById('btnSave');
  if (!b || b.disabled) return 'NO_SAVE';
  b.click(); return 'SAVED';
})()`);
await wait(3500);
await closeModals();
const madeName = await ev(`(() => {
  const made = window.__drive.created.filter(c => /앱에서 새로 쓴 것/.test(c.name || ''));
  return made.length ? made[made.length - 1].id : '';
})()`);
check("⑥-2 앱이 만든 기록은 이름 규칙대로 파일이 선다", wrote === "SAVED" && !!madeName,
  madeName ? await ev(`window.__drive.nameOf('${madeName}')`) : "안 만들어짐");

await ev(`window.__drive.reset(); true`);
await setSearch('앱에서 새로 쓴 것');
await wait(700);
const retitle2 = await openEditor();
await wait(800);
await ev(`(() => {
  const t = document.getElementById('title');
  t.value = '앱에서 새로 쓴 것 · 고친 제목';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await wait(300);
await pressSave();
await wait(3500);
await closeModals();
const madeNameNow = madeName ? await ev(`window.__drive.nameOf('${madeName}')`) : "";
check("⑥-2 앱이 만든 기록은 제목을 바꾸면 파일 이름도 따라간다",
  retitle2 === "OPEN" && /고친 제목/.test(String(madeNameNow)), `지금 이름: ${madeNameNow}`);

/* =========================================================
   상황 ⑦ · 사람이 파일을 연결한 폴더 «밖» 으로 꺼낸다
   이 앱의 권한(drive.file)으로는 아예 안 보인다. 조용히 안 열리면 안 된다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.move('H1', 'OUTSIDE'); true`);
await runImport();
const seen7 = await crumbOf("물의 상태변화 학습지");
/* ⚠️ 폴더 밖으로 나갔다고 «없다» 고 하면 안 된다. drive.file 권한은 파일 하나하나에
   붙으므로 밖으로 옮겨도 그 파일은 계속 열린다 · 훑기가 못 찾았을 뿐이다.
   그래서 파일 ID 로 직접 물어보고, 살아 있으면 조용히 «밖에 있다» 고만 적는다. */
const away7 = await ev(`document.querySelectorAll('.banner.away').length`);
check("⑦ 폴더 밖으로 나가면 «밖에 있다» 고 조용히 적는다", away7 > 0 && seen7.gone === 0,
  `밖 ${away7}곳 · 없음 ${seen7.gone}곳 · 카드 ${seen7.cards}장`);

/* =========================================================
   상황 ⑧ · 도로 넣으면 «안 보임» 이 걷혀야 한다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.move('H1', 'DSCI'); true`);
await runImport();
const seen8 = await crumbOf("물의 상태변화 학습지");
const hwp8 = await entryBy("H1");
check("⑧ 도로 넣으면 다시 보인다", seen8.gone === 0, `알림 ${seen8.gone}곳`);
check("⑧ 자리도 돌아온 자리로 다시 잡는다", !!hwp8 && hwp8.path.join("/") === "2019/과학",
  hwp8 ? hwp8.path.join(" › ") : "없음");

/* =========================================================
   상황 ⑨ · 사람이 드라이브에서 파일을 휴지통에 버린다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.trash('P1'); true`);
await runImport();
const seen9 = await crumbOf("수업사진");
check("⑨ 휴지통에 버린 것도 안 보인다고 말한다", seen9.gone > 0, `알림 ${seen9.gone}곳 · 카드 ${seen9.cards}장`);

/* =========================================================
   상황 ⑩ · 되돌리면 다시 보인다
   ========================================================= */
await ev(`window.__drive.reset(); window.__drive.untrash('P1'); true`);
await runImport();
const seen10 = await crumbOf("수업사진");
check("⑩ 휴지통에서 꺼내면 다시 보인다", seen10.gone === 0, `알림 ${seen10.gone}곳`);

/* =========================================================
   상황 ⑪ · 가져온 기록을 목록에서 빼도, 드라이브의 원본은 남아야 한다
   목록에서 빼는 것과 파일을 버리는 것은 전혀 다른 일이다
   ========================================================= */
await ev(`window.__drive.reset(); true`);
await setSearch('연수 다녀와서 남긴 것');
await wait(700);
const asked = await ev(`(() => {
  const c = document.querySelector('.card.entry');
  if (!c) return 'NO_CARD';
  /* ⚠️ 카드 단추는 제목 옆 ⋯ 안으로 들어갔다 · 열고 나서 눌러야 한다 */
  const __d = c.querySelector('.dots'); if (__d) __d.click();
  const b = Array.from(document.querySelectorAll('.menupop button')).find(x => (x.textContent||'').includes('삭제') || (x.textContent||'').includes('지우'));
  if (!b) return 'NO_DEL[' + Array.from(c.querySelectorAll('button')).map(x => x.textContent).join('|') + ']';
  b.click(); return 'ASKED';
})()`);
await wait(700);
/* ⚠️ 지우기는 «두 걸음» 이 됐다. 한 번 누르면 휴지통으로 가고(되돌릴 수 있으니 안 묻는다),
   거기서 «완전히 삭제» 를 눌러야 진짜로 지운다. 원본 이야기는 그 두 번째 자리에서 한다. */
await ev(`(() => {
  const row = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('휴지통') >= 0);
  if (row) row.click();
  const d = document.querySelector('.card.entry .dots'); if (d) d.click();
  const p2 = Array.from(document.querySelectorAll('.menupop button')).find(x => /완전히/.test(x.textContent||''));
  if (p2) p2.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return true;
})()`);
await wait(700);
const warned = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('삭제할까요'));
  return m ? (m.textContent || '') : '';
})()`);
check("⑪ 완전히 지우기 전에 «원본은 남는다» 고 말해 준다", /원본 파일은 그대로/.test(String(warned)),
  String(warned).replace(/\s+/g, ' ').slice(0, 60) || `${asked}`);
/* 물음만 읽었으니 취소하고 되돌려 놓는다 · 뒤 점검이 이 기록을 또 쓴다 */
await ev(`(() => {
  const no = Array.from(document.querySelectorAll('.modal-bg button')).find(b => (b.textContent||'').trim() === '취소');
  if (no) no.click();
  const back = Array.from(document.querySelectorAll('#list .entry button')).find(b => /되돌리기/.test(b.textContent||''));
  if (back) back.click();
  const all = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('모든 기록') >= 0);
  if (all) all.click();
  return true;
})()`);
await wait(700);
await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('삭제할까요'));
  if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => /삭제|확인|예/.test(x.textContent||''));
  if (b) b.click(); return true;
})()`);
await wait(2500);
await closeModals();
const trashed11 = await ev(`JSON.stringify(window.__drive.trashed)`);
const stillThere = await ev(`window.__drive.nameOf('MD1')`);
check("⑪ 목록에서 빼도 드라이브 원본은 안 버린다",
  trashed11 === "[]" && stillThere === "연수 정리본.md", `버린 것 ${trashed11} · 원본 ${stillThere}`);
await setSearch('');
await wait(400);

/* =========================================================
   내내 · 사람이 시키지 않은 옮기기·버리기는 한 번도 없어야 한다
   ========================================================= */
const finalMoved = await ev(`JSON.stringify(window.__drive.moved)`);
const finalTrashed = await ev(`JSON.stringify(window.__drive.trashed)`);
check("내내 앱이 제멋대로 옮기지 않았다", finalMoved === "[]", finalMoved);
check("내내 앱이 제멋대로 버리지 않았다", finalTrashed === "[]", finalTrashed);

/* =========================================================
   상황 ⑫ · 옛 정리 방식을 쓰던 사람
   고르는 목록에서는 뺐지만, 쓰던 사람의 설정은 그대로 돌아야 한다.
   여기서 기본값으로 되돌아가면 다음 저장부터 파일이 딴 곳에 쌓인다. 자료 사고다.
   ========================================================= */
await ev(`(() => {
  sessionStorage.setItem('keep', '1');   // 가짜 드라이브가 다시 비우지 않게
  var s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.folderMode = 'monthly';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.reload");
await wait(3000);
const kept = await ev(`(() => {
  var s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  return s.folderMode || '';
})()`);
check("⑫ 옛 방식을 쓰던 설정이 그대로 남는다", kept === "monthly", `지금 방식: ${kept || "비어 있음"}`);

await closeModals();
await ev(`document.getElementById('btnSettings').click(); true`);
await wait(500);
await ev(`(() => {
  const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '저장 위치');
  if (t) t.click(); return true;
})()`);
await wait(600);
const shown = await ev(`(() => {
  const cards = Array.from(document.querySelectorAll('.modecard'));
  return JSON.stringify({
    n: cards.length,
    names: cards.map(c => (c.querySelector('strong') || {}).textContent || ''),
    badge: cards.some(c => /지금 쓰는 방식/.test(c.textContent || '')),
    warn: cards.some(c => /목록에서 사라집니다/.test(c.textContent || ''))
  });
})()`).then((x) => JSON.parse(x));
check("⑫ 쓰던 옛 방식은 그 사람에게만 한 칸으로 보인다",
  shown.n === 3 && shown.names.indexOf("월별 폴더") >= 0 && shown.badge,
  `칸 ${shown.n}개 · ${shown.names.join(" / ")}`);
check("⑫ 떠나면 못 돌아온다고 미리 말해 준다", shown.warn, shown.warn ? "적혀 있음" : "말이 없다");
await closeModals();
await wait(300);

/* =========================================================
   상황 ⑬ · 파일 이름에 무엇을 넣을지 «고르는» 자리
   예전에는 프리셋 스물하나와 토큰 단추 열하나로 규칙을 손수 조립했다.
   지금은 조각 다섯을 켜고 끈다. 기본은 다섯 다 켜짐이고, 한 번 고르면 그대로 남아야 한다.
   ========================================================= */
const readNaming = () => ev(`(() => {
  const NAMES = ['날짜', '태그', '제목', '자료 제목', '번호'];
  const nameOf = (l) => (l.children[1] ? (l.children[1].textContent || '').trim() : '');
  const rows = Array.from(document.querySelectorAll('.mbody label'))
    .filter(l => l.querySelector('input[type=checkbox]') && NAMES.indexOf(nameOf(l)) >= 0);
  return JSON.stringify({
    n: rows.length,
    on: rows.filter(l => l.querySelector('input').checked).map(nameOf),
    locked: rows.filter(l => l.querySelector('input').disabled).map(nameOf),
    preview: Array.from(document.querySelectorAll('.mbody .preview')).map(x => x.textContent).join(' | '),
    old: /지금 쓰는 이름 규칙/.test(document.querySelector('.mbody').textContent || ''),
    toSimple: !!Array.from(document.querySelectorAll('.mbody button')).find(b => (b.textContent||'').includes('간단한 방식으로'))
  });
})()`).then((x) => JSON.parse(x));

const openNaming = async () => {
  await closeModals();
  await ev(`document.getElementById('btnSettings').click(); true`);
  await wait(500);
  await ev(`(() => {
    const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => (x.textContent||'').includes('파일 이름'));
    if (t) t.click(); return true;
  })()`);
  await wait(600);
  return readNaming();
};
const clickName = (label) => ev(
  "(() => { const rows = Array.from(document.querySelectorAll('.mbody label'));" +
  " const l = rows.find(x => x.children[1] && (x.children[1].textContent || '').trim() === " + JSON.stringify(label) + ");" +
  " if (!l) return 'NO_ROW'; const cb = l.querySelector('input[type=checkbox]');" +
  " if (!cb) return 'NO_BOX'; if (cb.disabled) return 'LOCKED'; cb.click(); return 'CLICKED'; })()"
);
const saveSettings = async () => {
  const r = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.mfoot button')).find(x => (x.textContent||'').trim() === '저장');
    if (!b) return 'NO_SAVE';
    b.click(); return 'SAVED';
  })()`);
  await wait(900);
  return r;
};

const nm0 = await openNaming();
check("⑬ 이름 조각 다섯을 고르는 자리가 있다", nm0.n === 5, `줄 ${nm0.n}개`);
/* ⚠️ 태어날 때의 이름은 «폴더명_제목» 이다 ({태그}_{제목}).
   날짜를 앞에 두면 «무엇에 대한 것인지» 가 이름 한가운데 묻힌다 · 조각은 다섯이지만
   처음부터 켜져 있는 것은 넷이고, 날짜는 사람이 켜서 쓴다. */
check("⑬ 처음에는 날짜만 꺼진 채로 넷이 켜져 있다",
  nm0.on.length === 4 && nm0.on.indexOf("날짜") < 0, nm0.on.join(" · ") || "하나도 안 켜짐");
check("⑬ 글과 사진·파일 이름을 그 자리에서 보여 준다",
  /\.md/.test(nm0.preview) && /\.png/.test(nm0.preview), nm0.preview.replace(/\s+/g, " ").slice(0, 70));

/* =========================================================
   상황 ⑭ · 하나를 끄면 이름에서 빠지고, 그 뒤로 계속 그대로여야 한다
   ========================================================= */
const off = await clickName("태그");
await wait(400);
const nm1 = await ev(`(() => Array.from(document.querySelectorAll('.mbody .preview')).map(x => x.textContent).join(' | '))()`);
check("⑭ 조각을 끄면 미리보기에서 바로 빠진다", off === "CLICKED" && !/수업설계/.test(nm1), nm1.replace(/\s+/g, " ").slice(0, 70));
check("⑭ 고른 것을 저장할 수 있다", (await saveSettings()) === "SAVED");
const stored = await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  return JSON.stringify({ md: s.mdPattern || '', file: s.filePattern || '' });
})()`).then((x) => JSON.parse(x));
check("⑭ 고른 것이 설정에 적힌다", stored.md.indexOf("{태그}") < 0 && stored.file.indexOf("{태그}") < 0,
  `글 ${stored.md} · 자료 ${stored.file}`);
const nm2 = await openNaming();
check("⑭ 다시 열어도 고른 그대로다", nm2.on.length === 3 && nm2.on.indexOf("태그") < 0, nm2.on.join(" · "));

/* =========================================================
   상황 ⑮ · 하나만 남으면 그것까지 끌 수는 없다
   다 끄면 모든 파일이 «무제» 가 된다. 말로 막지 않고 못 누르게 한다
   ========================================================= */
await clickName("자료 제목");
await wait(300);
await clickName("번호");
await wait(400);
const nm3 = await readNaming();   // ⚠️ 여기서 창을 다시 열면 아직 저장 안 한 것이 버려진다
check("⑮ 하나만 남으면 그 하나는 못 끈다",
  nm3.on.length === 1 && nm3.locked.length === 1 && nm3.locked[0] === nm3.on[0],
  `남은 것 ${nm3.on.join(",")} · 잠긴 것 ${nm3.locked.join(",")}`);
check("⑮ 그래도 이름은 «무제» 가 아니다", /수업 회고/.test(nm3.preview), nm3.preview.replace(/\s+/g, " ").slice(0, 60));

// 되돌려 놓는다 (뒤에 오는 점검이 기본 이름을 보게)
await clickName("태그"); await wait(250);
await clickName("자료 제목"); await wait(250);
await clickName("번호"); await wait(250);
await saveSettings();

/* =========================================================
   상황 ⑯ · 손으로 조립한 옛 규칙을 쓰던 사람
   조각 밖의 토큰({폴더명}·{원본이름} …)을 쓰고 있으면 말없이 갈아 치우면 안 된다
   ========================================================= */
await ev(`(() => {
  sessionStorage.setItem('keep', '1');
  var s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.filePattern = '{폴더명}_{원본이름}';
  s.mdPattern = '{유형}_{제목}';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.reload");
await wait(3000);
const nm4 = await openNaming();
check("⑯ 옛 규칙은 갈아 치우지 않고 그대로 보여 준다", nm4.old && nm4.n === 0, nm4.old ? "지금 쓰는 규칙으로 보임" : "조각 화면으로 갈아 치웠다");
check("⑯ 간단한 방식으로 옮겨 갈 길을 준다", nm4.toSimple, nm4.toSimple ? "단추 있음" : "단추 없음");
await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.mbody button')).find(x => (x.textContent||'').includes('간단한 방식으로'));
  if (b) b.click(); return true;
})()`);
await wait(700);
const nm5 = await ev(`(() => {
  const NAMES = ['날짜', '태그', '제목', '자료 제목', '번호'];
  const rows = Array.from(document.querySelectorAll('.mbody label')).filter(l =>
    l.querySelector('input[type=checkbox]') && l.children[1] &&
    NAMES.indexOf((l.children[1].textContent || '').trim()) >= 0);
  return rows.length;
})()`);
check("⑯ 누르면 그때 조각 다섯으로 바뀐다", nm5 === 5, `줄 ${nm5}개`);
await closeModals();
await wait(300);

/* =========================================================
   상황 ⑰ · 글 쪽 조각을 다 끌 수는 없다
   글 이름에 들어갈 수 있는 것은 날짜·태그·제목 셋뿐이다 (자료 제목·번호는 사진·파일에만).
   셋을 다 끄면 글은 지을 이름이 없어 모두 «무제.md» 가 된다.
   ⚠️ 그때 앱이 몰래 {제목} 을 도로 세우면, 다시 열었을 때 «끈 것이 켜져» 있다.
      «고르면 그대로 유지» 가 조용히 깨지는 자리다. 그래서 셋 가운데 마지막 하나를 잠근다.
   ========================================================= */
await ev(`(() => {
  sessionStorage.setItem('keep', '1');
  var s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  s.mdPattern = '{날짜}_{태그}_{제목}';
  s.filePattern = '{날짜}_{태그}_{제목}_{자료제목}_{번호}';
  localStorage.setItem('pkos.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.reload");
await wait(3000);

const p0 = await openNaming();
check("⑰ 넷이 켜진 자리에서 시작한다", p0.on.length === 4, p0.on.join(" · "));
/* 태어날 때 켜져 있는 글 쪽 조각은 «태그·제목» 둘이다 (날짜는 꺼진 채로 시작).
   하나를 끄면 남은 하나가 잠긴다 · 다 끄면 모든 글이 «무제» 가 되기 때문이다. */
await clickName("태그");
await wait(350);
const p1 = await readNaming();
check("⑰ 글 쪽 조각이 하나 남으면 그것이 잠긴다",
  p1.locked.length === 1 && p1.locked[0] === "제목", `잠긴 것 ${p1.locked.join(",") || "없음"}`);
const tryOff = await clickName("제목");
check("⑰ 잠긴 것은 눌러도 안 꺼진다", tryOff === "LOCKED", String(tryOff));
const off2 = await clickName("번호");
await wait(350);
const p2 = await readNaming();
check("⑰ 사진·파일 쪽 조각은 언제든 끌 수 있다",
  off2 === "CLICKED" && p2.on.indexOf("번호") < 0, p2.on.join(" · "));
await saveSettings();
const p3 = await openNaming();
check("⑰ 저장하고 다시 열어도 끈 것이 몰래 켜지지 않는다",
  p3.on.indexOf("태그") < 0 && p3.on.indexOf("날짜") < 0 && p3.on.indexOf("번호") < 0,
  p3.on.join(" · ") || "하나도 안 남음");
const named = await ev(`(() => {
  var s = JSON.parse(localStorage.getItem('pkos.settings.v1') || '{}');
  return JSON.stringify({ md: s.mdPattern || '', file: s.filePattern || '' });
})()`).then((x) => JSON.parse(x));
check("⑰ 글 이름이 «무제» 로 무너지지 않는다", named.md === "{제목}", `글 ${named.md} · 자료 ${named.file}`);
await closeModals();
await wait(300);

/* =========================================================
   상황 ⑱ · 「📛 밖에서 넣은 파일 이름 정리」 를 실제로 돌려 본다
   이 앱에서 가장 되돌리기 힘든 일이다. 십삼 년치 파일의 «이름» 을 바꾼다.
   그런데 여태 «단추가 있는가» 만 보고, 한 번도 눌러 본 적이 없었다.
   보는 것 · 무엇이 대상으로 잡히나 · 사람이 누를 때만 바뀌나 ·
   바뀐 이름이 원래 이름을 지우지 않나 · 파일 ID 가 그대로라 기록이 안 끊기나.
   ========================================================= */
await ev(`(() => {
  sessionStorage.setItem('keep', '1');
  window.__drive.reset();
  return true;
})()`);

const openTidy = async () => {
  await closeModals();
  await ev(`document.getElementById('btnMap').click(); true`);
  await wait(1200);
  await ev(`(() => {
    const t = Array.from(document.querySelectorAll('.mfoot button')).find(x => (x.textContent||'').includes('이름 정리'));
    if (t) t.click(); return true;
  })()`);
  // 폴더를 훑어 «정리할 것» 을 골라 올 때까지 기다린다
  for (let i = 0; i < 40; i++) {
    await wait(400);
    const ready = await ev(`(() => {
      const box = document.querySelector('.renamebox');
      if (!box) return false;
      const t = document.querySelector('.mbody').textContent || '';
      return /찾았습니다|정리할 파일이 없습니다|안 보입니다|훑지 못했습니다/.test(t);
    })()`);
    if (ready) break;
  }
  return ev(`(() => {
    const box = document.querySelector('.renamebox');
    if (!box) return JSON.stringify({ open: false });
    // 줄은 .renamerow 다. 지금 이름은 .renamewas, 바뀔 이름은 .renamenew 에 있다
    const rows = Array.from(box.querySelectorAll('.renamerow'));
    const txt = (r, sel) => { const e = r.querySelector(sel); return e ? (e.textContent || '').trim() : ''; };
    return JSON.stringify({
      open: true,
      names: rows.map(r => txt(r, '.renamewas')),
      proposed: rows.map(r => txt(r, '.renamenew')),
      count: (document.querySelector('.mfoot .desc') || {}).textContent || ''
    });
  })()`).then((x) => JSON.parse(x));
};

const td = await openTidy();
check("⑱ 이름 정리 창이 열리고 대상을 찾아 준다", td.open && td.names.length > 0,
  td.open ? `${td.names.length}개 · ${td.names.join(", ").slice(0, 60)}` : "안 열림");
/* 앱이 만든 색인·설정 파일과 이미 날짜로 시작하는 것은 대상이 아니다.
   여기에 색인이 끼면, 사람이 「전부 고르기」 한 번에 앱의 뼈대 파일 이름을 바꿔 버린다. */
check("⑱ 앱이 만든 색인·설정은 대상이 아니다",
  !td.names.some(n => /PKOS-index|PKOS-settings/.test(n)), td.names.join(", ").slice(0, 60));

const beforeNames = await ev(`JSON.stringify({
  H1: window.__drive.nameOf('H1'), P1: window.__drive.nameOf('P1')
})`).then((x) => JSON.parse(x));
const renamedBefore = await ev(`JSON.stringify(window.__drive.renamed)`);
check("⑱ 창을 열어 놓기만 해서는 아무것도 안 바뀐다", renamedBefore === "[]", renamedBefore);

// 사람이 「전부 고르기」 → 「이름 바꾸기」 를 누른다
const pressed = await ev(`(() => {
  /* 「전부 고르기」 는 토글이다. 줄은 처음부터 다 골라져 있으므로
     여기서 누르면 오히려 전부 풀린다. 그대로 두고 누른다. */
  const go = Array.from(document.querySelectorAll('.mfoot button')).find(x => (x.textContent||'').includes('이름 바꾸기'));
  if (!go) return 'NO_GO';
  if (go.disabled) return 'DISABLED';
  go.click(); return 'CLICKED';
})()`);
check("⑱ 사람이 고르고 누를 수 있다", pressed === "CLICKED", String(pressed));
for (let i = 0; i < 40; i++) {
  await wait(400);
  const done = await ev(`/개를 바꿨습니다/.test(document.querySelector('.mbody').textContent || '')`);
  if (done) break;
}
const after = await ev(`JSON.stringify({
  H1: window.__drive.nameOf('H1'),
  P1: window.__drive.nameOf('P1'),
  renamed: window.__drive.renamed,
  moved: window.__drive.moved,
  trashed: window.__drive.trashed
})`).then((x) => JSON.parse(x));

check("⑱ 눌렀을 때 이름이 바뀐다", after.renamed.length > 0, `${after.renamed.length}개`);
/* 「원래 이름은 지우지 않습니다」 가 이 창의 약속이다.
   앞에 날짜와 폴더 이름만 붙는다. 원래 이름이 사라지면 사람이 제 파일을 못 찾는다. */
const keptStem = (before, now) => {
  const stem = String(before).replace(/\.[^.]+$/, "");
  return String(now).indexOf(stem) >= 0;
};
check("⑱ 원래 이름을 지우지 않고 앞에만 붙인다",
  keptStem(beforeNames.H1, after.H1) && keptStem(beforeNames.P1, after.P1),
  `${after.H1} · ${after.P1}`);
check("⑱ 날짜로 시작하게 된다",
  /^\d{4}-\d{2}-\d{2}_/.test(after.H1) && /^\d{4}-\d{2}-\d{2}_/.test(after.P1),
  `${after.H1} · ${after.P1}`);
/* 이름만 바꾸는 일이다. 옮기거나 버리면 그건 다른 일이다 */
check("⑱ 이름만 바꾸지, 옮기거나 버리지 않는다",
  after.moved.length === 0 && after.trashed.length === 0,
  `옮김 ${after.moved.length} · 버림 ${after.trashed.length}`);

// 파일 ID 가 그대로여야 기록이 안 끊긴다. 앱은 이름이 아니라 ID 로 붙잡고 있다
await closeModals();
await wait(400);
const stillLinked = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  return L.filter(e => e.srcId === 'H1' || e.srcId === 'P1').length;
})()`);
check("⑱ 이름이 바뀌어도 기록은 그 파일을 그대로 붙잡고 있다", stillLinked >= 1, `이어진 기록 ${stillLinked}편`);

// 한 번 정리한 것은 다시 대상이 되지 않는다 (날짜로 시작하므로)
const td2 = await openTidy();
check("⑱ 한 번 정리한 것은 다시 대상이 아니다",
  !td2.names.some(n => /^\d{4}-\d{2}-\d{2}_/.test(n)), td2.names.join(", ").slice(0, 60) || "대상 없음");
await closeModals();
await wait(300);

/* =========================================================
   상황 ⑲ · 목록에서 뺐다가 «다시 가져오기» 를 누르면 돌아와야 한다
   가져온 것을 지우는 것은 «목록에서만 빼는 일» 이다 (원본은 그대로 있다).
   그러니 다시 훑으면 다시 들어오는 것이 사람이 기대하는 바다.
   ⚠️ 그런데 지운 표시(tombstone)가 색인에 남아 있으면, 들어왔다가
      새로고침 한 번에 도로 사라진다. «분명히 가져왔는데 없다» 가 된다.
   ========================================================= */
await ev(`(() => { sessionStorage.setItem('keep', '1'); window.__drive.reset(); return true; })()`);
await closeModals();
// 지울 기록을 «제목» 이 아니라 «어느 파일에서 왔는가» 로 집는다. 제목은 앞 상황에서 바뀌었다
const mdTitle = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  const e = L.find(x => x.mdId === 'MD1');
  return e ? e.title : '';
})()`);
await setSearch(mdTitle);
await wait(700);
const gone = await ev(`(() => {
  const want = ${JSON.stringify("")} + document.getElementById('search').value;
  const cards = Array.from(document.querySelectorAll('.card.entry'));
  const c = cards.find(x => (x.textContent || '').indexOf(want) >= 0) || cards[0];
  if (!c) return 'NO_CARD';
  /* ⚠️ 카드 단추는 제목 옆 ⋯ 안으로 들어갔다 · 열고 나서 눌러야 한다 */
  const __d = c.querySelector('.dots'); if (__d) __d.click();
  const b = Array.from(document.querySelectorAll('.menupop button')).find(x => (x.textContent||'').includes('삭제'));
  if (!b) return 'NO_DEL[' + cards.length + ']';
  b.click(); return 'ASKED';
})()`);
await wait(700);
/* ⚠️ 지우기는 «두 걸음» 이다 · 휴지통까지 갔다가 거기서 완전히 지워야 색인에서 빠진다 */
await ev(`(() => {
  const row = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(b => b.textContent.indexOf('휴지통') >= 0);
  if (row) row.click();
  const d = document.querySelector('.card.entry .dots'); if (d) d.click();
  const p2 = Array.from(document.querySelectorAll('.menupop button')).find(x => /완전히/.test(x.textContent||''));
  if (p2) p2.click();
  document.querySelectorAll('.menupop').forEach(p => p.remove());
  return true;
})()`);
await wait(700);
await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('삭제할까요'));
  if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => /삭제|확인|예/.test(x.textContent||''));
  if (b) b.click();
  const all = Array.from(document.querySelectorAll('#sideNav .smartrow')).find(x => x.textContent.indexOf('모든 기록') >= 0);
  if (all) all.click();
  return true;
})()`);
await wait(2000);
await closeModals();
const afterDel = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  const T = JSON.parse(localStorage.getItem('pkos.tombstones.v1') || '[]');
  return JSON.stringify({ has: L.some(e => e.mdId === 'MD1'), tombs: T.length,
    titles: L.map(e => e.title).join(", ").slice(0, 60) });
})()`).then((x) => JSON.parse(x));
check("⑲ 목록에서 빼면 목록에서 사라진다", gone === "ASKED" && !afterDel.has,
  `${gone} · 지운 표시 ${afterDel.tombs}개 · 남은 것 ${afterDel.titles}`);
check("⑲ 빼도 드라이브 원본은 그대로다", (await ev(`window.__drive.nameOf('MD1')`)) !== null,
  await ev(`window.__drive.nameOf('MD1')`));

await setSearch('');
await wait(300);
await runImport();
const back = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  return JSON.stringify({ has: L.some(e => e.mdId === 'MD1') });
})()`).then((x) => JSON.parse(x));
check("⑲ 다시 훑으면 돌아온다", back.has, back.has ? "돌아옴" : "안 돌아옴");

/* ⚠️ 진짜 자리는 여기다. 새로고침하면 색인을 다시 합치는데,
   그때 지운 표시가 살아 있으면 방금 가져온 것이 도로 지워진다. */
await send("Page.reload");
await wait(3200);
const afterReload = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  return JSON.stringify({ has: L.some(e => e.mdId === 'MD1'), n: L.length });
})()`).then((x) => JSON.parse(x));
check("⑲ 새로고침해도 도로 사라지지 않는다", afterReload.has,
  afterReload.has ? "그대로 있음" : `사라짐 · 남은 기록 ${afterReload.n}편`);

/* =========================================================
   상황 ⑳ · 드라이브에서 옮겨 둔 글을 앱에서 고쳐 저장한다
   여기가 예전에 «가져온 뒤 고치면 원본이 딸려 옴» 이 났던 바로 그 자리다.
   기록마다 폴더 하나 방식에서는 가져온 기록에 제 폴더가 없어서,
   한 번 고치는 것만으로 폴더가 새로 생기고 원본이 그리로 끌려 들어갔다.
   ========================================================= */
await ev(`(() => { sessionStorage.setItem('keep', '1'); window.__drive.reset(); return true; })()`);
const whereWas = await ev(`window.__drive.parentOf('MD1')`);
await ev(`window.__drive.move('MD1', 'DSCI'); true`);   // 사람이 「과학」 으로 끌어다 놓았다
await runImport();                                        // 앱이 새 자리를 배운다
await closeModals();
const mdTitle2 = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('pkos.entries.v2') || '[]');
  const e = L.find(x => x.mdId === 'MD1');
  return e ? e.title : '';
})()`);
await setSearch(mdTitle2);
await wait(700);
const opened20 = await openEditor();
await wait(800);
await ev(`(() => {
  const ta = document.querySelector('#blocks textarea, textarea');
  if (ta) { ta.value = (ta.value || '') + ' 한 줄 더.'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  return true;
})()`);
await wait(300);
await pressSave();
await wait(3500);
await closeModals();
const where20 = await ev(`window.__drive.parentOf('MD1')`);
const moved20 = await ev(`JSON.stringify(window.__drive.moved)`);
check("⑳ 옮겨 둔 글을 고쳐 저장할 수 있다", opened20 === "OPEN", String(opened20));
check("⑳ 고쳐 저장해도 원본이 딸려 오지 않는다", where20 === "DSCI" && moved20 === "[]",
  `지금 자리 ${where20} (처음 ${whereWas}) · 옮긴 기록 ${moved20}`);
await setSearch('');
await wait(300);

/* =========================================================
   상황 ㉑ · 「기존 파일도 새 방식으로 옮기기」 를 사람이 누르면
   앱이 만든 것은 새 방식대로 옮기고, 밖에서 온 것은 제자리에 둔다.
   ⚠️ 「사람이 시켰을 때만 옮긴다」 로 고치면서 이 길이 통째로 죽을 수 있었다.
      그런데 여태 아무 점검도 이 단추를 눌러 본 적이 없었다.
   ========================================================= */
await ev(`(() => { window.__drive.reset(); return true; })()`);
await closeModals();
await ev(`document.getElementById('btnSettings').click(); true`);
await wait(500);
await ev(`(() => {
  const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '저장 위치');
  if (t) t.click(); return true;
})()`);
await wait(700);
const pressedReorg = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.mbody button')).find(x => (x.textContent||'').includes('기존 파일도 새 방식으로'));
  if (!b) return 'NO_BUTTON';
  if (b.disabled) return 'DISABLED';
  b.click(); return 'CLICKED';
})()`);
check("㉑ 「기존 파일도 새 방식으로 옮기기」 를 누를 수 있다", pressedReorg === "CLICKED", String(pressedReorg));
let saidDone = "";
for (let i = 0; i < 50; i++) {
  await wait(400);
  saidDone = await ev(`(() => {
    const box = document.querySelector('.card.modal');
    const t = box ? box.textContent : '';
    const m = /정리했습니다[^]{0,60}/.exec(t || '');
    return m ? m[0] : '';
  })()`);
  if (saidDone) break;
}
// 안 끝났으면 화면이 무슨 말을 하고 있는지 그대로 가져온다. 짐작으로 고치지 않으려고
const tabText = await ev(`(() => {
  const b = document.querySelector('.mbody');
  return b ? (b.textContent || '').replace(/\s+/g, ' ').slice(-160) : '창이 없다';
})()`);
check("㉑ 끝나면 끝났다고 말해 준다", /정리했습니다/.test(saidDone),
  saidDone.replace(/\s+/g, " ").slice(0, 70) || ("지금 글: " + tabText));
check("㉑ 밖에서 가져온 것은 제자리에 두었다고 말해 준다",
  /제자리에 두었습니다/.test(saidDone), saidDone.replace(/\s+/g, " ").slice(0, 70));

const moved21 = await ev(`JSON.stringify(window.__drive.moved)`).then((x) => JSON.parse(x));
const src = ["MD1", "H1", "P1"];
check("㉑ 밖에서 온 원본은 한 개도 안 옮겼다",
  !moved21.some((m) => src.indexOf(m.id) >= 0),
  moved21.map((m) => m.id).join(",") || "한 개도 안 옮김");
await closeModals();
await wait(300);

const realErrors = errors.filter((e) => !/GSI_LOGGER|popup|ERR_INTERNET|ERR_NAME|gsi\/client|404/i.test(String(e)));
check("옮기고 바꾸고 버리는 내내 오류 없음", realErrors.length === 0, realErrors[0] || "");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
