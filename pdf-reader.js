/* PDF.js runs locally; document bytes are never sent to a conversion service. */
(function () {
  "use strict";
  const base = new URL("vendor/pdfjs/", document.currentScript.src).href;
  let library;
  async function open(file) {
    if (file.size > 128 * 1024 * 1024) throw new Error("128MB가 넘는 PDF는 원본 파일로 열어 주세요.");
    if (!library) library = import(base + "build/pdf.min.mjs").catch(e => { library = null; throw e; });
    const pdfjs = await library;
    pdfjs.GlobalWorkerOptions.workerSrc = base + "build/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: base + "cmaps/", cMapPacked: true,
      standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", isEvalSupported: false, enableXfa: false });
    try { return { pdf: await task.promise, dispose: () => task.destroy() }; }
    catch (e) { await task.destroy(); throw e; }
  }
  async function contains(file, query, cancelled = () => false) {
    const { pdf, dispose } = await open(file);
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        if (cancelled()) return false;
        const page = await pdf.getPage(n), content = await page.getTextContent();
        const lines = content.items.map(item => item.str || "");
        const text = lines.join(" ").toLowerCase();
        if (text.includes(query) || lines.join("").toLowerCase().includes(query)) return true;
        page.cleanup();
      }
      return false;
    } finally { await dispose(); }
  }
  async function preview(file, host) {
    const { pdf, dispose } = await open(file);
    if (!host.isConnected) { await dispose(); return; }
    let pageNumber = 1, job = null, disposed = false, rendering = false;
    host.textContent = "";
    const controls = document.createElement("div"); controls.className = "media-slide-nav";
    const previous = document.createElement("button"), next = document.createElement("button"), label = document.createElement("span"), canvas = document.createElement("canvas");
    previous.textContent = "이전 쪽"; next.textContent = "다음 쪽";
    previous.type = next.type = "button"; previous.className = next.className = "btn sm";
    label.setAttribute("aria-live", "polite"); canvas.style.width = "100%"; canvas.style.height = "auto";
    controls.append(previous, label, next); host.append(controls, canvas);
    const observer = new MutationObserver(() => {
      if (!host.isConnected && !disposed) { disposed = true; observer.disconnect(); if (job) job.cancel(); dispose().catch(() => {}); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    async function draw() {
      if (rendering || disposed) return;
      rendering = true; previous.disabled = next.disabled = true;
      label.textContent = pageNumber + " / " + pdf.numPages;
      try {
        const page = await pdf.getPage(pageNumber), unit = page.getViewport({ scale: 1 });
        if (disposed) return;
        const scale = Math.min(2, Math.max(0.1, (host.clientWidth || 720) / unit.width)), viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute("aria-label", "PDF " + pageNumber + "쪽");
        job = page.render({ canvasContext: canvas.getContext("2d"), viewport }); await job.promise;
        const content = await page.getTextContent();
        canvas.title = content.items.map(item => item.str || "").join(" ").slice(0, 1000);
        host.dataset.pdfRendered = String(pageNumber); page.cleanup();
      } catch (e) { if (!disposed) label.textContent = "이 쪽을 표시하지 못했습니다. 원본 파일을 열어 주세요."; }
      finally { job = null; rendering = false; previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= pdf.numPages; }
    }
    previous.onclick = e => { e.stopPropagation(); if (!rendering && pageNumber > 1) { pageNumber--; draw(); } };
    next.onclick = e => { e.stopPropagation(); if (!rendering && pageNumber < pdf.numPages) { pageNumber++; draw(); } };
    await draw();
  }
  window.PKOSPdf = { contains, preview };
})();
