/* Read-only local Office/HWPX previews. No upload, macro execution or archive extraction. */
(function () {
  "use strict";
  const LIMIT = 16 * 1024 * 1024, TOTAL = 48 * 1024 * 1024;
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  function fail(message) { throw new Error(message); }
  async function archive(file) {
    const start = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(start).arrayBuffer());
    let end = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { end = i; break; }
    if (end < 0) fail("압축 구조를 읽지 못했습니다. 암호나 파일 손상을 확인해 주세요.");
    const count = tail.getUint16(end + 10, true), size = tail.getUint32(end + 12, true), offset = tail.getUint32(end + 16, true);
    if (tail.getUint32(end + 4, true) || count === 65535 || offset === 0xffffffff || count > 20000 || size > LIMIT || offset + size > start + end) fail("이 압축 형식은 미리보기를 지원하지 않습니다.");
    const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()), v = new DataView(bytes.buffer), items = new Map();
    let at = 0, used = 0;
    for (let n = 0; n < count; n++) {
      if (at + 46 > size || v.getUint32(at, true) !== 0x02014b50) fail("압축 목록이 손상됐습니다.");
      const len = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
      if (at + 46 + len + extra + comment > size) fail("압축 목록이 잘렸습니다.");
      const rawName=bytes.slice(at+46,at+46+len);
      let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(rawName);}catch(_){name=new TextDecoder('euc-kr').decode(rawName);}
      if (items.has(name)) fail("같은 경로가 중복된 압축 파일입니다.");
      items.set(name, { crc: v.getUint32(at + 16, true), flags: v.getUint16(at + 8, true), method: v.getUint16(at + 10, true), packed: v.getUint32(at + 20, true), size: v.getUint32(at + 24, true), pos: v.getUint32(at + 42, true) });
      at += 46 + len + extra + comment;
    }
    async function read(name) {
      const item = items.get(name); if (!item) fail("문서 구성 파일을 찾지 못했습니다: " + name);
      if (item.flags & 1) fail("암호가 걸린 파일은 원본 앱에서 열어 주세요.");
      if (item.size > LIMIT || used + item.size > TOTAL) fail("문서가 커서 내용 미리보기를 중단했습니다. 원본 파일을 열어 주세요.");
      if (item.pos + 30 > offset) fail("파일 위치 정보가 손상됐습니다.");
      const header = new DataView(await file.slice(item.pos, item.pos + 30).arrayBuffer());
      if (header.getUint32(0, true) !== 0x04034b50) fail("압축 파일 머리 정보가 손상됐습니다.");
      const begin = item.pos + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      if (begin + item.packed > offset) fail("압축 파일이 잘렸습니다.");
      let stream = file.slice(begin, begin + item.packed).stream();
      if (item.method === 8) stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
      else if (item.method !== 0) fail("이 압축 방식은 미리보기를 지원하지 않습니다.");
      const reader = stream.getReader(), chunks = []; let length = 0;
      try {
        while (true) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > item.size || length > LIMIT || used + length > TOTAL) fail("압축 해제 크기가 한도를 초과했습니다."); chunks.push(r.value); }
      } catch (e) { await reader.cancel().catch(() => {}); throw e; }
      if (length !== item.size) fail("압축 파일 크기가 일치하지 않습니다.");
      let crc = 0xffffffff; for (const chunk of chunks) for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
      if (((crc ^ 0xffffffff) >>> 0) !== item.crc) fail("압축 파일의 내용 검증에 실패했습니다.");
      used += length; return new Blob(chunks);
    }
    return { items, read };
  }
  function nodes(root, name) { return Array.from(root.getElementsByTagNameNS("*", name)); }
  async function xml(zip, path) {
    const str = await (await zip.read(path)).text();
    if (/<!DOCTYPE|<!ENTITY/i.test(str)) fail("외부 엔티티를 포함한 문서는 읽지 않습니다.");
    const doc = new DOMParser().parseFromString(str, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) fail("문서 XML을 읽지 못했습니다."); return doc;
  }
  function textOf(root, name) { return nodes(root, name).map(n => n.textContent).join(""); }
  function paragraphs(doc) {
    return nodes(doc, "p").map(p => nodes(p, "t").filter(t => {
      let parent = t.parentElement;
      while (parent && parent.localName !== "p") parent = parent.parentElement;
      return parent === p;
    }).map(t => t.textContent).join("")).filter(Boolean);
  }
  function pathAt(base, relative) {
    const parts = base.split("/"); parts.pop();
    if (relative.startsWith("/")) parts.length = 0;
    for (const part of relative.split("/")) { if (part === "..") { if (!parts.length) fail("문서 경로가 잘못됐습니다."); parts.pop(); } else if (part && part !== ".") parts.push(part); }
    return parts.join("/");
  }
  async function relationshipList(zip, base) {
    const slash = base.lastIndexOf("/"), path = base.slice(0, slash + 1) + "_rels/" + base.slice(slash + 1) + ".rels", out = [];
    if (!zip.items.has(path)) return out;
    for (const r of nodes(await xml(zip, path), "Relationship")) if (r.getAttribute("TargetMode") !== "External") out.push({ id: r.getAttribute("Id"), type: r.getAttribute("Type") || "", target: pathAt(base, r.getAttribute("Target")) });
    return out;
  }
  async function relationships(zip, base) {
    const out = new Map();
    for (const r of await relationshipList(zip, base)) out.set(r.id, r.target);
    return out;
  }
  // 종류(Type)가 …/header 처럼 끝나는 관계의 대상만 (머리글·바닥글·메모·그림판)
  async function relatedParts(zip, base, kinds) {
    return (await relationshipList(zip, base)).filter(r => kinds.some(k => r.type.endsWith("/" + k))).map(r => r.target);
  }
  /* OOXML 문서 안의 그림 참조(blip) → 압축 안 경로. 못 푼 참조는 null 로 남겨 «건너뛴 그림» 으로 센다 */
  async function blipTargets(zip, doc, path) {
    const rels = await relationships(zip, path);
    return nodes(doc, "blip").map(n => rels.get(relationshipAttr(n, "embed")) || null);
  }
  const relationshipAttr = (n, attr) => n.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", attr) || n.getAttributeNS("http://purl.oclc.org/ooxml/officeDocument/relationships", attr) || n.getAttribute("r:" + attr);
  /* 2026-09-17 · 그림 찾기와 싣기를 갈랐다. 형식마다 «어디에 그림이 있나» 만 section.imageTargets 에 모으고,
     싣는 일(크기 한도·형식 확인·data: 주소)은 여기 한 곳에서 한다. 워드 머리글·바닥글, 엑셀 그림판, 한글 BinData, 오픈문서 Pictures 가 다 이 길로 온다. */
  async function embeddedImages(zip, sections) {
    const cache = new Map(); let total = 0, count = 0, skipped = false;
    for (const section of sections) {
      const targets = section.imageTargets || []; delete section.imageTargets;
      if (!targets.length) continue;
      section.images = [];
      const seen = new Set();
      for (const target of targets) {
        if (!target) { skipped = true; continue; }
        if (seen.has(target)) continue;
        seen.add(target);
        if (count >= 48) { skipped = true; continue; }
        try {
          if (!cache.has(target)) {
            const entry = zip.items.get(target);
            if (!entry || entry.size > 4 * 1024 * 1024 || total + entry.size > 8 * 1024 * 1024) throw new Error("image limit");
            const bytes = new Uint8Array(await (await zip.read(target)).arrayBuffer());
            const prefix = String.fromCharCode(...bytes.slice(0, 12));
            let type = "";
            if (bytes[0] === 137 && prefix.slice(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10) type = "image/png";
            else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = "image/jpeg";
            else if (/^GIF8[79]a/.test(prefix)) type = "image/gif";
            else if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP") type = "image/webp";
            if (!type) throw new Error("unsupported image");
            let binary = "";
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            cache.set(target, { src: "data:" + type + ";base64," + btoa(binary), name: target.split("/").pop() });
            total += bytes.length;
          }
          section.images.push(cache.get(target)); count++;
        } catch (_) { skipped = true; }
      }
    }
    return skipped;
  }
  const relationshipId = n => n.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || n.getAttributeNS("http://purl.oclc.org/ooxml/officeDocument/relationships", "id") || n.getAttribute("r:id");
  const ODF = { text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0", table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0", office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0", draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" };
  function odfNodes(root, ns, name) { return Array.from(root.getElementsByTagNameNS(ODF[ns], name)); }
  function repeated(node, ns, attr) {
    const value = node.getAttributeNS(ODF[ns], attr);
    if (!value) return 1;
    const count = Number(value); if (!Number.isSafeInteger(count) || count < 1) fail("문서의 반복 개수가 잘못됐습니다."); return count;
  }
  function odfText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    if (node.namespaceURI === ODF.text) {
      if (node.localName === "s") return " ".repeat(Math.min(10000, repeated(node, "text", "c")));
      if (node.localName === "tab") return "\t";
      if (node.localName === "line-break") return "\n";
      if (node.localName === "script") return "";
    }
    return Array.from(node.childNodes, odfText).join("");
  }
  const XLINK = "http://www.w3.org/1999/xlink";
  function odfImageTargets(zip, root) {   // <draw:image xlink:href="Pictures/…"/> · 밖을 가리키는 주소는 건너뛴다
    return odfNodes(root, "draw", "image").map(n => { const h = n.getAttributeNS(XLINK, "href") || ""; return /^[a-z][a-z0-9+.-]*:/i.test(h) || !zip.items.has(h) ? null : h; });
  }
  function odfParagraphs(root) {
    return Array.from(root.getElementsByTagNameNS(ODF.text, "*")).filter(n => n.localName === "p" || n.localName === "h").map(odfText).filter(Boolean);
  }
  async function readOdf(zip, ext) {
    const doc = await xml(zip, "content.xml"), body = odfNodes(doc, "office", "body")[0];
    if (!body) fail("OpenDocument 본문을 찾지 못했습니다.");
    const kind = { odt: "text", ods: "spreadsheet", odp: "presentation" }[ext], main = odfNodes(body, "office", kind)[0];
    if (!main) fail("파일 확장자와 OpenDocument 본문 종류가 다릅니다.");
    if (ext === "odt") return [{ title: "본문", lines: odfParagraphs(main), imageTargets: odfImageTargets(zip, main) }];
    if (ext === "odp") return odfNodes(main, "draw", "page").map((page, i) => ({ title: page.getAttributeNS(ODF.draw, "name") || "슬라이드 " + (i + 1), lines: odfParagraphs(page), imageTargets: odfImageTargets(zip, page) }));
    return odfNodes(main, "table", "table").filter(table => table.parentElement === main).map(table => {
      let rowNumber = 1;
      const lines = [];
      for (const row of odfNodes(table, "table", "table-row")) {
        let owner = row.parentElement; while (owner && owner.localName !== "table") owner = owner.parentElement;
        if (owner !== table) continue;
        const rowCount = repeated(row, "table", "number-rows-repeated"), cells = []; let col = 1;
        for (const cell of Array.from(row.children).filter(n => n.namespaceURI === ODF.table && ["table-cell", "covered-table-cell"].includes(n.localName))) {
          const count = repeated(cell, "table", "number-columns-repeated");
          const text = odfParagraphs(cell).join(" ") || ["string-value", "value", "date-value", "time-value", "boolean-value"].map(a => cell.getAttributeNS(ODF.office, a)).find(v => v !== null) || "";
          if (text) cells.push("열 " + col + (count > 1 ? "~" + (col + count - 1) : "") + ": " + text);
          col += count; if (!Number.isSafeInteger(col)) fail("문서의 열 범위를 읽지 못했습니다.");
        }
        if (cells.length) lines.push("행 " + rowNumber + (rowCount > 1 ? "~" + (rowNumber + rowCount - 1) : "") + " | " + cells.join(" | "));
        rowNumber += rowCount; if (!Number.isSafeInteger(rowNumber)) fail("문서의 행 범위를 읽지 못했습니다.");
      }
      return { title: table.getAttributeNS(ODF.table, "name") || "시트", lines, imageTargets: odfImageTargets(zip, table) };
    });
  }
  /* 한글(HWPX) 그림 · 본문의 <hc:img binaryItemIDRef="image1"/> → Contents/content.hpf 목록의 href → BinData/… */
  async function hwpxManifest(zip) {
    const out = new Map();
    if (!zip.items.has("Contents/content.hpf")) return out;
    for (const item of nodes(await xml(zip, "Contents/content.hpf"), "item")) {
      const id = item.getAttribute("id"), href = item.getAttribute("href") || "";
      if (!id || !href) continue;
      const candidates = [href, "Contents/" + href, href.replace(/^Contents\//, "")];
      out.set(id, candidates.find(c => zip.items.has(c)) || null);
    }
    return out;
  }
  function hwpxImageTargets(root, manifest) {
    return nodes(root, "img").map(n => { const id = n.getAttribute("binaryItemIDRef"); return id ? (manifest.get(id) || null) : null; });
  }
  async function read(file, name, options = {}) {
    const zip = await archive(file), ext = name.split(".").pop().toLowerCase(), sections = [];
    if (ext === "zip") return { sections: [{ title: "압축 파일 목록", lines: Array.from(zip.items, ([name, info]) => name + " (" + info.size + " bytes)") }], note: "파일 목록만 표시합니다. 압축을 풀거나 실행하지 않습니다." };
    if (["odt", "ods", "odp"].includes(ext)) {
      const odfSections = await readOdf(zip, ext), odfImages = odfSections.some(s => (s.imageTargets || []).length) && !options.fullText && options.images !== false;
      const odfSkipped = odfImages ? await embeddedImages(zip, odfSections) : (odfSections.forEach(s => { delete s.imageTargets; }), false);
      return { sections: odfSections, note: (odfImages ? "텍스트와 포함된 그림을 표시합니다. 원본의 글꼴·배치·도형 효과는 재현하지 않습니다." : "내용 미리보기입니다. 원본의 글꼴·배치·그림은 재현하지 않습니다.") + (odfSkipped ? " 일부 그림은 형식이나 크기 때문에 생략했습니다." : "") + (ext === "ods" ? " 반복되는 행·열은 범위로 표시하며 수식은 재계산하지 않습니다." : "") };
    }
    if (ext === "docx") {
      const path = "word/document.xml", doc = await xml(zip, path), section = { title: "본문", lines: paragraphs(doc), imageTargets: await blipTargets(zip, doc, path) };
      // 머리글·바닥글의 그림은 본문 그림 뒤에 잇는다 (로고·도장이 여기 있다)
      for (const part of await relatedParts(zip, path, ["header", "footer"])) {
        try { section.imageTargets.push(...await blipTargets(zip, await xml(zip, part), part)); } catch (_) { section.imageTargets.push(null); }
      }
      sections.push(section);
    } else if (ext === "hwpx") {
      const paths = Array.from(zip.items.keys()).filter(p => /^Contents\/section\d+\.xml$/i.test(p)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!paths.length) fail("한글 문서의 본문을 찾지 못했습니다.");
      const manifest = await hwpxManifest(zip);
      for (const path of paths) { const doc = await xml(zip, path); sections.push({ title: "구역 " + (sections.length + 1), lines: paragraphs(doc), imageTargets: hwpxImageTargets(doc, manifest) }); }
    } else if (ext === "pptx") {
      const path = "ppt/presentation.xml", doc = await xml(zip, path), rels = await relationships(zip, path);
      for (const slide of nodes(doc, "sldId")) {
        const part = rels.get(relationshipId(slide)); if (!part) fail("슬라이드 연결을 찾지 못했습니다.");
        const slideDoc = await xml(zip, part), section = { title: "슬라이드 " + (sections.length + 1), lines: paragraphs(slideDoc), imageTargets: await blipTargets(zip, slideDoc, part) };
        // 발표자 메모 · 슬라이드 본문 아래 「메모:」 로 잇는다. 검색도 이 줄을 본다
        for (const notesPart of await relatedParts(zip, part, ["notesSlide"])) {
          try {
            const notes = paragraphs(await xml(zip, notesPart)).filter(line => !/^\d+$/.test(line.trim()));
            if (notes.length) section.lines.push("메모: " + notes.join(" "));
          } catch (_) { /* 메모를 못 읽어도 슬라이드는 보인다 */ }
        }
        sections.push(section);
      }
    } else if (ext === "xlsx") {
      const strings = zip.items.has("xl/sharedStrings.xml") ? nodes(await xml(zip, "xl/sharedStrings.xml"), "si").map(n => textOf(n, "t")) : [];
      const path = "xl/workbook.xml", doc = await xml(zip, path), rels = await relationships(zip, path);
      for (const sheet of nodes(doc, "sheet")) {
        const part = rels.get(relationshipId(sheet)); if (!part) fail("시트 연결을 찾지 못했습니다.");
        const rows = nodes(await xml(zip, part), "row"), rowLimit = options.fullText ? rows.length : 1000; let truncated = rows.length > rowLimit;
        const lines = rows.slice(0,rowLimit).map(row => nodes(row,"c").map(c => {
          const type = c.getAttribute("t"), value = textOf(c, "v"), formula = textOf(c, "f");
          const display = type === "s" ? (strings[Number(value)] || "") : type === "inlineStr" ? textOf(c,"t") : type === "b" ? (value === "1" ? "TRUE" : "FALSE") : value;
          return (c.getAttribute("r") || "셀") + ": " + (display || (formula ? "=" + formula : ""));
        }).join(" | "));
        if (truncated) lines.push("앞부분 1000행만 표시합니다.");
        // 시트에 붙은 그림판(drawing)의 그림
        const imageTargets = [];
        for (const drawing of await relatedParts(zip, part, ["drawing"])) {
          try { imageTargets.push(...await blipTargets(zip, await xml(zip, drawing), drawing)); } catch (_) { imageTargets.push(null); }
        }
        sections.push({ title: sheet.getAttribute("name") || "시트", lines, imageTargets });
      }
    } else fail("이 문서 형식은 아직 지원하지 않습니다.");
    const withImages = sections.some(s => (s.imageTargets || []).length) && !options.fullText && options.images !== false;
    const skippedImages = withImages ? await embeddedImages(zip, sections) : (sections.forEach(s => { delete s.imageTargets; }), false);
    return { sections, note: (withImages ? "텍스트와 포함된 이미지를 표시합니다. 원본의 글꼴·배치·도형 효과는 재현하지 않습니다." : "내용 미리보기입니다. 원본의 글꼴·배치·그림은 재현하지 않습니다.") + (skippedImages ? " 일부 이미지는 크기·형식·연결 문제로 생략했습니다. 원본 파일에서 확인해 주세요." : "") + (ext === "xlsx" ? " 숫자는 저장된 값으로 표시하며 날짜·통화 서식과 수식 재계산은 적용하지 않습니다." : "") };
  }
  async function extract(file) {
    const zip=await archive(file), files=[];
    for(const [path] of zip.items){
      const normalized=path.replace(/\\/g,'/');
      if(normalized.startsWith('/')||/^[a-z]:/i.test(normalized)||normalized.split('/').some(p=>p==='..'||p==='.'||p.includes(':')))fail('압축 파일 경로가 올바르지 않습니다.');
      if(normalized.endsWith('/')||normalized.startsWith('__MACOSX/')||normalized.split('/').pop()==='.DS_Store')continue;
      const blob=await zip.read(path);files.push({path:normalized,blob});
    }
    return files;
  }
  window.PKOSDocuments = { read, extract, supports: name => /\.(docx|xlsx|pptx|hwpx|odt|ods|odp|zip)$/i.test(name) };
})();
