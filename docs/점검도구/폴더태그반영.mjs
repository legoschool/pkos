/* 폴더·태그 반영 점검 · 사람이 탐색기에서 폴더와 파일을 만들고 지울 때 화면이 따라오는지 본다.
   브라우저 안의 OPFS 를 «윈도우 폴더» 대신 붙여, 앱 밖에서 파일을 만들고 지운다.
   설치할 것 없음 (노드 24 · Edge). 실행:  node docs/점검도구/폴더태그반영.mjs [주소] */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8123/";
const PORT = await new Promise((res, rej) => {
  const srv = createServer();
  srv.on("error", rej);
  srv.listen(0, "127.0.0.1", () => { const got = srv.address().port; srv.close(() => res(got)); });
});
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "pkos-folders-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,900", URL_,
], { stdio: "ignore" });
process.on("exit", () => { try { edge.kill(); } catch {} });
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => { try { edge.kill(); } catch {} process.exit(130); }));

let ws, msgId = 0;
const pending = new Map();
const errors = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 이 30초 안에 답하지 않았습니다`)); }, 30000);
    pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
}
async function waitFor(expression, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return true; } catch {}
    await wait(250);
  }
  return false;
}
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " · " + detail : ""}`);
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

/* ---- 앱 «밖에서» 폴더를 손대는 손 · 탐색기가 하는 일과 같다 ---- */
const mkdir = (parts) => `(async () => { let d = await navigator.storage.getDirectory();
  for (const p of ${JSON.stringify(parts)}) d = await d.getDirectoryHandle(p, { create: true }); return true; })()`;
const writeMd = (parts, name, text) => `(async () => { let d = await navigator.storage.getDirectory();
  for (const p of ${JSON.stringify(parts)}) d = await d.getDirectoryHandle(p, { create: true });
  const h = await d.getFileHandle(${JSON.stringify(name)}, { create: true }), w = await h.createWritable();
  await w.write(new Blob([${JSON.stringify(text)}], { type: "text/markdown" })); await w.close(); return true; })()`;
const rmdir = (name) => `(async () => { const d = await navigator.storage.getDirectory();
  await d.removeEntry(${JSON.stringify(name)}, { recursive: true }); return true; })()`;

const note = (title, tag) => `---
title: "${title}"
tags: ["${tag}"]
created: 2026-09-16T01:00:00.000Z
updated: 2026-09-16T01:00:00.000Z
---

# ${title}

탐색기에서 만든 파일입니다.
`;
const folderRows = `Array.from(document.querySelectorAll('#sideNav .siderow .n')).map(e => e.textContent)`;
const quickFolderRows = `Array.from(document.querySelectorAll('#sideNav .folderquick .n')).map(e => e.textContent)`;
const tagChips = `Array.from(document.querySelectorAll('#tagFilters .chip')).map(e => e.textContent)`;
const tagRows = `Array.from(document.querySelectorAll('#sideNav .tagrow .n')).map(e => e.textContent)`;
const listTitles = `Array.from(document.querySelectorAll('#list .entry h3')).map(e => e.textContent)`;

ws = new WebSocket(await connect());
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await waitFor(`!!document.getElementById('composer') && document.readyState === 'complete'`);

try {
  await evaluate(writeMd(["수업자료"], "2026-09-16_수업기록.md", note("수업 기록", "시험태그")));
  await evaluate(writeMd(["지난폴더"], "2026-09-16_지난기록.md", note("지난 기록", "지난태그")));
  await evaluate(writeMd(["자주폴더"], "2026-09-16_자주기록.md", note("자주 기록", "자주태그")));
  await evaluate(`(async () => { await pkosLocal.attach(await navigator.storage.getDirectory()); })()`);
  check("폴더를 붙이면 그 안의 글을 읽는다", await waitFor(`${listTitles}.some(t => t.includes('수업 기록'))`));
  check("만든 폴더가 왼쪽에 선다", await waitFor(`${folderRows}.includes('수업자료')`), await evaluate(folderRows).then(JSON.stringify));
  check("내 기록장에 여러 빠른 폴더가 함께 보인다", await waitFor(`${quickFolderRows}.length >= 3`), await evaluate(quickFolderRows).then(JSON.stringify));
  check("그 글의 태그가 선다", await waitFor(`${tagChips}.some(t => t.includes('시험태그')) && ${tagRows}.includes('시험태그')`));

  /* ---- 탐색기에서 폴더째 지운다 (앱은 켜 둔 채) ---- */
  await evaluate(rmdir("수업자료"));
  check("지운 글이 목록에서 빠진다", await waitFor(`!${listTitles}.some(t => t.includes('수업 기록'))`, 12000));
  const goneFolder = await waitFor(`!${folderRows}.includes('수업자료')`, 12000);
  check("지운 폴더가 왼쪽에서 빠진다", goneFolder, await evaluate(folderRows).then(JSON.stringify));
  const goneTagChip = await waitFor(`!${tagChips}.some(t => t.includes('시험태그'))`, 12000);
  check("지운 글의 태그 칩이 빠진다", goneTagChip, await evaluate(tagChips).then(JSON.stringify));
  const goneTagRow = await waitFor(`!${tagRows}.includes('시험태그')`, 12000);
  check("지운 글의 왼쪽 태그가 빠진다", goneTagRow, await evaluate(tagRows).then(JSON.stringify));

  /* ---- 탐색기에서 빈 폴더를 새로 만든다 ---- */
  await evaluate(mkdir(["새폴더"]));
  const madeEmpty = await waitFor(`${folderRows}.includes('새폴더')`, 12000);
  check("새로 만든 빈 폴더가 왼쪽에 선다", madeEmpty, await evaluate(folderRows).then(JSON.stringify));

  /* ---- 앱에서 기록을 완전히 지우면 실제 빈 폴더와 왼쪽 줄도 함께 빠진다 ---- */
  await evaluate(writeMd(["완전삭제"], "2026-09-16_지울기록.md", note("지울 기록", "삭제시험")));
  check("완전히 지울 기록의 폴더가 먼저 선다", await waitFor(`${folderRows}.includes('완전삭제')`, 12000));
  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('#sideNav .siderow')).find(b => b.querySelector('.n')?.textContent === '완전삭제');
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 240, clientY: 240 }));
    const menu = Array.from(document.querySelectorAll('.menupop button')).find(b => b.textContent.includes('완전히 삭제'));
    if (!menu) return false;
    menu.click();
    const yes = Array.from(document.querySelectorAll('#modalHost button')).find(b => b.textContent.trim() === '완전히 삭제');
    if (!yes) return false;
    yes.click();
    return true;
  })()`);
  const purgedFolder = await waitFor(`!${folderRows}.includes('완전삭제')`, 12000);
  check("완전히 지운 빈 폴더가 왼쪽에서 바로 빠진다", purgedFolder, await evaluate(folderRows).then(JSON.stringify));

  /* ---- 저장 위치로 골라 둔 폴더를 밖에서 지우면 ---- */
  await evaluate(writeMd(["연수"], "2026-09-16_연수기록.md", note("연수 기록", "연수태그")));
  await waitFor(`${folderRows}.includes('연수')`, 12000);
  await evaluate(`(() => { const row = Array.from(document.querySelectorAll('#sideNav .siderow')).find(b => b.querySelector('.n')?.textContent === '연수'); row.click(); return true; })()`);
  await wait(600);
  await evaluate(rmdir("연수"));
  const goneDesk = await waitFor(`!${folderRows}.includes('연수')`, 12000);
  check("저장 위치로 골랐던 폴더도 지우면 빠진다", goneDesk, await evaluate(folderRows).then(JSON.stringify));

  check("실행 오류 없음", errors.length === 0, errors.join("\n"));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} finally {
  ws.close();
  edge.kill();
}
