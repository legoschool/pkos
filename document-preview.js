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
      const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + len));
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
  async function relationships(zip, base) {
    const slash = base.lastIndexOf("/"), path = base.slice(0, slash + 1) + "_rels/" + base.slice(slash + 1) + ".rels", out = new Map();
    if (!zip.items.has(path)) return out;
    for (const r of nodes(await xml(zip, path), "Relationship")) if (r.getAttribute("TargetMode") !== "External") out.set(r.getAttribute("Id"), pathAt(base, r.getAttribute("Target")));
    return out;
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
  function odfParagraphs(root) {
    return Array.from(root.getElementsByTagNameNS(ODF.text, "*")).filter(n => n.localName === "p" || n.localName === "h").map(odfText).filter(Boolean);
  }
  async function readOdf(zip, ext) {
    const doc = await xml(zip, "content.xml"), body = odfNodes(doc, "office", "body")[0];
    if (!body) fail("OpenDocument 본문을 찾지 못했습니다.");
    const kind = { odt: "text", ods: "spreadsheet", odp: "presentation" }[ext], main = odfNodes(body, "office", kind)[0];
    if (!main) fail("파일 확장자와 OpenDocument 본문 종류가 다릅니다.");
    if (ext === "odt") return [{ title: "본문", lines: odfParagraphs(main) }];
    if (ext === "odp") return odfNodes(main, "draw", "page").map((page, i) => ({ title: page.getAttributeNS(ODF.draw, "name") || "슬라이드 " + (i + 1), lines: odfParagraphs(page) }));
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
      return { title: table.getAttributeNS(ODF.table, "name") || "시트", lines };
    });
  }
  async function read(file, name, options = {}) {
    const zip = await archive(file), ext = name.split(".").pop().toLowerCase(), sections = [];
    if (ext === "zip") return { sections: [{ title: "압축 파일 목록", lines: Array.from(zip.items, ([name, info]) => name + " (" + info.size + " bytes)") }], note: "파일 목록만 표시합니다. 압축을 풀거나 실행하지 않습니다." };
    if (["odt", "ods", "odp"].includes(ext)) return { sections: await readOdf(zip, ext), note: "내용 미리보기입니다. 원본의 글꼴·배치·그림은 재현하지 않습니다." + (ext === "ods" ? " 반복되는 행·열은 범위로 표시하며 수식은 재계산하지 않습니다." : "") };
    if (ext === "docx") {
      sections.push({ title: "본문", lines: paragraphs(await xml(zip, "word/document.xml")) });
    } else if (ext === "hwpx") {
      const paths = Array.from(zip.items.keys()).filter(p => /^Contents\/section\d+\.xml$/i.test(p)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!paths.length) fail("한글 문서의 본문을 찾지 못했습니다.");
      for (const path of paths) sections.push({ title: "구역 " + (sections.length + 1), lines: paragraphs(await xml(zip, path)) });
    } else if (ext === "pptx") {
      const path = "ppt/presentation.xml", doc = await xml(zip, path), rels = await relationships(zip, path);
      for (const slide of nodes(doc, "sldId")) {
        const part = rels.get(relationshipId(slide)); if (!part) fail("슬라이드 연결을 찾지 못했습니다.");
        sections.push({ title: "슬라이드 " + (sections.length + 1), lines: paragraphs(await xml(zip, part)) });
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
        sections.push({ title: sheet.getAttribute("name") || "시트", lines });
      }
    } else fail("이 문서 형식은 아직 지원하지 않습니다.");
    return { sections, note: "내용 미리보기입니다. 원본의 글꼴·배치·그림은 재현하지 않습니다." + (ext === "xlsx" ? " 숫자는 저장된 값으로 표시하며 날짜·통화 서식과 수식 재계산은 적용하지 않습니다." : "") };
  }
  window.PKOSDocuments = { read, supports: name => /\.(docx|xlsx|pptx|hwpx|odt|ods|odp|zip)$/i.test(name) };
})();
