(function () {
  "use strict";
  var PRODUCT_VERSION = "PKOS NEW 1.0";
  function byId(id) { return document.getElementById(id); }
  function addSkipLink() {
    var link = document.createElement("a");
    link.className = "pkos-skip";
    link.href = "#blocks";
    link.textContent = "본문으로 건너뛰기";
    document.body.insertBefore(link, document.body.firstChild);
  }
  function addConnectionLabel() {
    var sync = byId("syncPill");
    if (!sync || byId("pkosConnection")) return;
    var label = document.createElement("span");
    label.id = "pkosConnection";
    label.className = "pkos-connection";
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    label.dataset.state = "busy";
    sync.insertAdjacentElement("afterend", label);
    function update() {
      var text = (sync.textContent || "").trim();
      var value = text + " " + (sync.className || "");
      if (/오류|실패|끊|없음/.test(value)) label.dataset.state = "error";
      else if (/저장|동기|읽|처리|busy/.test(value)) label.dataset.state = "busy";
      else label.dataset.state = "ready";
      label.textContent = text || "이 브라우저에 저장";
    }
    new MutationObserver(update).observe(sync, { childList: true, subtree: true, attributes: true });
    update();
  }
  function addKeyboardShortcuts() {
    document.addEventListener("keydown", function (event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        var search = byId("search");
        if (search) { search.focus(); search.select(); }
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        var create = byId("topNew");
        if (create) create.click();
      }
    });
  }
  function improveLabels() {
    document.documentElement.dataset.pkosEdition = "new";
    document.documentElement.dataset.pkosVersion = PRODUCT_VERSION;
    var search = byId("search");
    if (search) { search.placeholder = "제목과 내용 검색"; search.setAttribute("aria-label", "제목과 내용 검색, 단축키 Ctrl K"); }
    var create = byId("topNew");
    if (create) create.title = "새 기록, 단축키 Ctrl N";
  }
  function boot() { addSkipLink(); addConnectionLabel(); addKeyboardShortcuts(); improveLabels(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}());
