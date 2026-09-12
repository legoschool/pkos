/* Keep an offline app shell. Online requests still check the server first. */
var SHELL_CACHE = "pkos-shell-20260912-ppt-search";
var SHELL_FILES = ["./", "index.html", "document-preview.js", "pdf-reader.js", "vendor/pdfjs/cmaps/78-EUC-H.bcmap", "vendor/pdfjs/cmaps/78-EUC-V.bcmap", "vendor/pdfjs/cmaps/78-H.bcmap", "vendor/pdfjs/cmaps/78-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/78-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/78-V.bcmap", "vendor/pdfjs/cmaps/78ms-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/78ms-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/83pv-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/90ms-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/90ms-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/90msp-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/90msp-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/90pv-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/90pv-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/Add-H.bcmap", "vendor/pdfjs/cmaps/Add-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/Add-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/Add-V.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-0.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-1.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-2.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-3.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-4.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-5.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-6.bcmap", "vendor/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-0.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-1.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-2.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-3.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-4.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-5.bcmap", "vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-1.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-2.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-3.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-4.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-5.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-6.bcmap", "vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap", "vendor/pdfjs/cmaps/Adobe-Korea1-0.bcmap", "vendor/pdfjs/cmaps/Adobe-Korea1-1.bcmap", "vendor/pdfjs/cmaps/Adobe-Korea1-2.bcmap", "vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap", "vendor/pdfjs/cmaps/B5-H.bcmap", "vendor/pdfjs/cmaps/B5-V.bcmap", "vendor/pdfjs/cmaps/B5pc-H.bcmap", "vendor/pdfjs/cmaps/B5pc-V.bcmap", "vendor/pdfjs/cmaps/CNS-EUC-H.bcmap", "vendor/pdfjs/cmaps/CNS-EUC-V.bcmap", "vendor/pdfjs/cmaps/CNS1-H.bcmap", "vendor/pdfjs/cmaps/CNS1-V.bcmap", "vendor/pdfjs/cmaps/CNS2-H.bcmap", "vendor/pdfjs/cmaps/CNS2-V.bcmap", "vendor/pdfjs/cmaps/ETen-B5-H.bcmap", "vendor/pdfjs/cmaps/ETen-B5-V.bcmap", "vendor/pdfjs/cmaps/ETenms-B5-H.bcmap", "vendor/pdfjs/cmaps/ETenms-B5-V.bcmap", "vendor/pdfjs/cmaps/ETHK-B5-H.bcmap", "vendor/pdfjs/cmaps/ETHK-B5-V.bcmap", "vendor/pdfjs/cmaps/EUC-H.bcmap", "vendor/pdfjs/cmaps/EUC-V.bcmap", "vendor/pdfjs/cmaps/Ext-H.bcmap", "vendor/pdfjs/cmaps/Ext-RKSJ-H.bcmap", "vendor/pdfjs/cmaps/Ext-RKSJ-V.bcmap", "vendor/pdfjs/cmaps/Ext-V.bcmap", "vendor/pdfjs/cmaps/GB-EUC-H.bcmap", "vendor/pdfjs/cmaps/GB-EUC-V.bcmap", "vendor/pdfjs/cmaps/GB-H.bcmap", "vendor/pdfjs/cmaps/GB-V.bcmap", "vendor/pdfjs/cmaps/GBK-EUC-H.bcmap", "vendor/pdfjs/cmaps/GBK-EUC-V.bcmap", "vendor/pdfjs/cmaps/GBK2K-H.bcmap", "vendor/pdfjs/cmaps/GBK2K-V.bcmap", "vendor/pdfjs/cmaps/GBKp-EUC-H.bcmap", "vendor/pdfjs/cmaps/GBKp-EUC-V.bcmap", "vendor/pdfjs/cmaps/GBpc-EUC-H.bcmap", "vendor/pdfjs/cmaps/GBpc-EUC-V.bcmap", "vendor/pdfjs/cmaps/GBT-EUC-H.bcmap", "vendor/pdfjs/cmaps/GBT-EUC-V.bcmap", "vendor/pdfjs/cmaps/GBT-H.bcmap", "vendor/pdfjs/cmaps/GBT-V.bcmap", "vendor/pdfjs/cmaps/GBTpc-EUC-H.bcmap", "vendor/pdfjs/cmaps/GBTpc-EUC-V.bcmap", "vendor/pdfjs/cmaps/H.bcmap", "vendor/pdfjs/cmaps/Hankaku.bcmap", "vendor/pdfjs/cmaps/Hiragana.bcmap", "vendor/pdfjs/cmaps/HKdla-B5-H.bcmap", "vendor/pdfjs/cmaps/HKdla-B5-V.bcmap", "vendor/pdfjs/cmaps/HKdlb-B5-H.bcmap", "vendor/pdfjs/cmaps/HKdlb-B5-V.bcmap", "vendor/pdfjs/cmaps/HKgccs-B5-H.bcmap", "vendor/pdfjs/cmaps/HKgccs-B5-V.bcmap", "vendor/pdfjs/cmaps/HKm314-B5-H.bcmap", "vendor/pdfjs/cmaps/HKm314-B5-V.bcmap", "vendor/pdfjs/cmaps/HKm471-B5-H.bcmap", "vendor/pdfjs/cmaps/HKm471-B5-V.bcmap", "vendor/pdfjs/cmaps/HKscs-B5-H.bcmap", "vendor/pdfjs/cmaps/HKscs-B5-V.bcmap", "vendor/pdfjs/cmaps/Katakana.bcmap", "vendor/pdfjs/cmaps/KSC-EUC-H.bcmap", "vendor/pdfjs/cmaps/KSC-EUC-V.bcmap", "vendor/pdfjs/cmaps/KSC-H.bcmap", "vendor/pdfjs/cmaps/KSC-Johab-H.bcmap", "vendor/pdfjs/cmaps/KSC-Johab-V.bcmap", "vendor/pdfjs/cmaps/KSC-V.bcmap", "vendor/pdfjs/cmaps/KSCms-UHC-H.bcmap", "vendor/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap", "vendor/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap", "vendor/pdfjs/cmaps/KSCms-UHC-V.bcmap", "vendor/pdfjs/cmaps/KSCpc-EUC-H.bcmap", "vendor/pdfjs/cmaps/KSCpc-EUC-V.bcmap", "vendor/pdfjs/cmaps/NWP-H.bcmap", "vendor/pdfjs/cmaps/NWP-V.bcmap", "vendor/pdfjs/cmaps/RKSJ-H.bcmap", "vendor/pdfjs/cmaps/RKSJ-V.bcmap", "vendor/pdfjs/cmaps/Roman.bcmap", "vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap", "vendor/pdfjs/cmaps/UniCNS-UCS2-V.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF16-H.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF16-V.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF8-H.bcmap", "vendor/pdfjs/cmaps/UniCNS-UTF8-V.bcmap", "vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap", "vendor/pdfjs/cmaps/UniGB-UCS2-V.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF16-H.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF16-V.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap", "vendor/pdfjs/cmaps/UniGB-UTF8-V.bcmap", "vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap", "vendor/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap", "vendor/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap", "vendor/pdfjs/cmaps/UniJIS-UCS2-V.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF16-V.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF8-H.bcmap", "vendor/pdfjs/cmaps/UniJIS-UTF8-V.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap", "vendor/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap", "vendor/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap", "vendor/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap", "vendor/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap", "vendor/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniKS-UCS2-H.bcmap", "vendor/pdfjs/cmaps/UniKS-UCS2-V.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF16-V.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF32-H.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF32-V.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF8-H.bcmap", "vendor/pdfjs/cmaps/UniKS-UTF8-V.bcmap", "vendor/pdfjs/cmaps/V.bcmap", "vendor/pdfjs/cmaps/WP-Symbol.bcmap", "vendor/pdfjs/build/pdf.min.mjs", "vendor/pdfjs/build/pdf.worker.min.mjs", "vendor/pdfjs/standard_fonts/FoxitDingbats.pfb", "vendor/pdfjs/standard_fonts/FoxitFixed.pfb", "vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb", "vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb", "vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb", "vendor/pdfjs/standard_fonts/FoxitSerif.pfb", "vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb", "vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb", "vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb", "vendor/pdfjs/standard_fonts/FoxitSymbol.pfb", "vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf", "vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf", "vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf", "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf", "vendor/pdfjs/wasm/jbig2.wasm", "vendor/pdfjs/wasm/openjpeg.wasm", "vendor/pdfjs/wasm/qcms_bg.wasm", "vendor/pdfjs/wasm/quickjs-eval.wasm"];
var shellUrls = SHELL_FILES.map(function (p) { return new URL(p, self.registration.scope).href; });
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
    return cache.addAll(shellUrls);
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.indexOf("pkos-shell-") === 0 && key !== SHELL_CACHE; }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

var OFFLINE_HTML =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>연결 없음</title><style>' +
  'body{font-family:system-ui,"Malgun Gothic",sans-serif;background:#f5f7fb;color:#1b2130;' +
  'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}' +
  'div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 10px}' +
  'p{color:#667085;line-height:1.7;margin:0}</style></head><body><div>' +
  "<h1>인터넷에 연결되어 있지 않습니다</h1>" +
  "<p>이 기기에 앱의 오프라인 사본이 아직 없습니다.<br>" +
  "연결한 뒤 다시 열어 주세요.</p>" +
  "</div></body></html>";

/* ---- 다른 앱에서 «공유» 로 보낸 것 받기 ----
 * 안드로이드 공유 시트에서 이 앱을 고르면 여기로 POST 가 들어온다.
 * 서비스 워커 안에서는 화면을 그릴 수 없으니, 받은 것을 캐시에 잠깐 넣어 두고
 * 앱 주소로 돌려보낸다. 화면 쪽에서 그것을 꺼내 블록으로 만든다.
 * 왜 캐시냐 · 파일(사진)을 통째로 담아 옮길 수 있는 가장 단순한 그릇이다.
 */
var SHARE_CACHE = "pkos-share-inbox";

function takeShare(request) {
  return request.formData().then(function (form) {
    var files = form.getAll("files").filter(function (f) { return f && f.size; });
    var meta = {
      title: form.get("title") || "",
      text: form.get("text") || "",
      url: form.get("url") || "",
      at: Date.now(),
      files: files.map(function (f, i) {
        return { key: "file" + i, name: f.name || ("공유파일" + (i + 1)), type: f.type || "application/octet-stream", size: f.size };
      })
    };
    return caches.open(SHARE_CACHE).then(function (cache) {
      var jobs = [cache.put("/__share__/meta", new Response(JSON.stringify(meta), {
        headers: { "Content-Type": "application/json" }
      }))];
      files.forEach(function (f, i) {
        jobs.push(cache.put("/__share__/file" + i, new Response(f, {
          headers: { "Content-Type": f.type || "application/octet-stream" }
        })));
      });
      return Promise.all(jobs);
    });
  }).then(function () {
    return Response.redirect(new URL("./?share=1", self.registration.scope).href, 303);
  }).catch(function () {
    return Response.redirect(new URL("./", self.registration.scope).href, 303);
  });
}

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method === "POST" && /\/share$/.test(url.pathname)) {
    e.respondWith(takeShare(e.request));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== new URL(self.registration.scope).origin) return;
  var plain = url.origin + url.pathname;
  if (shellUrls.indexOf(plain) < 0) return;
  e.respondWith((async function () {
    var cache = await caches.open(SHELL_CACHE);
    try {
      var response = await fetch(e.request);
      if (response.ok) {
        try { await cache.put(plain, response.clone()); } catch (ignore) {}
        return response;
      }
      var old = await cache.match(plain);
      return old || response;
    } catch (error) {
      var saved = await cache.match(plain);
      if (saved) return saved;
      if (e.request.mode === "navigate") return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      return Response.error();
    }
  })());
});
