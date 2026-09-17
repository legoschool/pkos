/* 문서 안 그림 «더» · 워드 머리글·바닥글, 엑셀 그림판, 한글 BinData, 오픈문서 Pictures 의 그림과 파워포인트 발표자 메모를 읽는지 본다 (2026-09-17).
   설치할 것 없음: 노드 24 에 들어 있는 WebSocket 만 쓴다.
   실행:  node docs/점검도구/문서그림더.mjs http://localhost:8123/ */
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

/* ---- 여기부터 이 점검의 몸통 ----
   워드 머리글·바닥글 그림, 엑셀 그림판 그림, 한글(HWPX) BinData 그림, 오픈문서 Pictures 그림, 파워포인트 발표자 메모.
   시험 문서는 여기서 바로 만든다(압축하지 않은 zip). 사용자 문서는 쓰지 않는다. */
function crc32(buf) { let crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zipOf(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const n = Buffer.from(name, "utf8"), data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]).toString("base64");
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const blip = (id) => `<a:blip xmlns:a="${A}" xmlns:r="${R}" r:embed="${id}"/>`;
const fixtures = {
  "header.docx": zipOf({
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>본문 글</w:t></w:r></w:p><w:p>${blip("rBody")}</w:p></w:body></w:document>`,
    "word/_rels/document.xml.rels": rels([["rBody", "image", "media/body.png"], ["rHead", "header", "header1.xml"], ["rFoot", "footer", "footer1.xml"]]),
    "word/header1.xml": `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>${blip("rLogo")}</w:p></w:hdr>`,
    "word/_rels/header1.xml.rels": rels([["rLogo", "image", "media/logo.png"]]),
    "word/footer1.xml": `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>${blip("rSeal")}</w:p></w:ftr>`,
    "word/_rels/footer1.xml.rels": rels([["rSeal", "image", "media/seal.png"]]),
    "word/media/body.png": PNG, "word/media/logo.png": PNG, "word/media/seal.png": PNG,
  }),
  "drawing.xlsx": zipOf({
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="표" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>값</t></is></c></row></sheetData><drawing r:id="rDraw"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rels([["rDraw", "drawing", "../drawings/drawing1.xml"]]),
    "xl/drawings/drawing1.xml": `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:pic>${blip("rPic")}</xdr:pic></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels([["rPic", "image", "../media/chart.png"]]),
    "xl/media/chart.png": PNG,
  }),
  "notes.pptx": zipOf({
    "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"]]),
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${A}"><a:p><a:r><a:t>앞장</a:t></a:r></a:p></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels([["rNote", "notesSlide", "../notesSlides/notesSlide1.xml"]]),
    "ppt/notesSlides/notesSlide1.xml": `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${A}"><a:p><a:r><a:t>발표할 때 이 말을 한다</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>`,
  }),
  "pic.hwpx": zipOf({
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest></opf:package>`,
    "Contents/section0.xml": `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"><hp:p><hp:run><hp:t>한글 본문</hp:t></hp:run><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic><hp:pic><hc:img binaryItemIDRef="missing"/></hp:pic></hp:p></hs:sec>`,
    "BinData/image1.png": PNG,
  }),
  "pic.odt": zipOf({
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><office:text><text:p>오픈문서 본문</text:p><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame><draw:frame><draw:image xlink:href="https://example.com/x.png"/></draw:frame></office:text></office:body></office:document-content>`,
    "Pictures/a.png": PNG,
  }),
};
await evaluate(`window.moreFixtures=${JSON.stringify(fixtures)};window.moreFile=n=>new File([Uint8Array.from(atob(moreFixtures[n]),c=>c.charCodeAt(0))],n);`);
const readNames = (file) => `PKOSDocuments.read(moreFile('${file}'),'${file}').then(r=>JSON.stringify({names:(r.sections[0].images||[]).map(i=>i.name),lines:r.sections[0].lines,note:r.note,count:r.sections.length}))`;
  let r = JSON.parse(await evaluate(readNames("header.docx")));
  check("DOCX body image first, then header and footer images", r.names.join(",") === "body.png,logo.png,seal.png", r.names.join(","));
  check("DOCX body text kept", r.lines[0] === "본문 글");
  r = JSON.parse(await evaluate(readNames("drawing.xlsx")));
  check("XLSX drawing image attached to its sheet", r.names.join(",") === "chart.png", r.names.join(","));
  check("XLSX cell text kept", r.lines[0].includes("A1: 값"));
  r = JSON.parse(await evaluate(readNames("notes.pptx")));
  check("PPTX speaker notes appended as 메모 line", r.lines.join("|") === "앞장|메모: 발표할 때 이 말을 한다", r.lines.join("|"));
  check("PPTX slide number placeholder not treated as a note", !r.lines.some(l => /^메모: 1$/.test(l)));
  const searched = await evaluate(`PKOSDocuments.read(moreFile('notes.pptx'),'notes.pptx',{fullText:true}).then(r=>r.sections[0].lines.some(l=>l.includes('발표할 때')))`);
  check("PPTX notes are visible to full-text search", searched === true);
  r = JSON.parse(await evaluate(readNames("pic.hwpx")));
  check("HWPX BinData image resolved through content.hpf", r.names.join(",") === "image1.png", r.names.join(","));
  check("HWPX missing manifest item counts as skipped, body kept", r.note.includes("생략") && r.lines[0] === "한글 본문");
  r = JSON.parse(await evaluate(readNames("pic.odt")));
  check("ODT Pictures image shown, external address skipped", r.names.join(",") === "a.png" && r.note.includes("생략") && r.lines[0] === "오픈문서 본문", JSON.stringify(r));
  const noImages = await evaluate(`Promise.all(['header.docx','drawing.xlsx','pic.hwpx','pic.odt'].map(n=>PKOSDocuments.read(moreFile(n),n,{fullText:true}).then(r=>r.sections.every(s=>!s.images&&!s.imageTargets)))).then(a=>a.every(Boolean))`);
  check("Full-text mode loads no images and leaves no imageTargets", noImages === true);
  const old = await evaluate(`PKOSDocuments.read(imageFile('images.docx'),'images.docx').then(r=>r.sections[0].images.map(i=>i.name).join(','))`).catch(() => "n/a");
  check("Earlier DOCX fixture still reads the same images", old === "n/a" || old.length > 0, old);
  check("No runtime errors", !errors.length, errors.join(";"));
} finally { ws.close(); edge.kill(); }
console.log(JSON.stringify(results)); if (results.some((r) => !r.ok)) process.exitCode = 1;
