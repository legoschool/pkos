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
  function applyWorkspaceDesign() {
    document.documentElement.dataset.design='v2';
    var logo=byId('btnHome');if(logo){logo.textContent='PKOS';logo.setAttribute('aria-label','PKOS 개인지식운영체계 홈');}
    var navSearch=document.createElement('button');navSearch.className='pkos-nav-search';navSearch.textContent='자료 검색     Ctrl K';navSearch.onclick=function(){var s=byId('search');s.focus();s.select();};
    var brand=document.querySelector('#appNav .brand');if(brand)brand.after(navSearch);
    var bar=byId('addbar');
    if(bar){
      var insert=document.createElement('details');insert.className='pkos-insert';
      var summary=document.createElement('summary');summary.textContent='+ 삽입';insert.appendChild(summary);
      var menu=document.createElement('div');menu.className='pkos-insert-menu';insert.appendChild(menu);
      Array.from(bar.querySelectorAll('[data-add]')).forEach(function(b){if(b.dataset.add!=='heading'){menu.appendChild(b);b.addEventListener('click',function(){insert.open=false;});}});
      bar.appendChild(insert);
      Array.from(bar.querySelectorAll('.edgrp')).forEach(function(g){if(!g.children.length)g.remove();});
      document.addEventListener('click',function(e){if(!insert.contains(e.target))insert.open=false;});
      insert.addEventListener('keydown',function(e){if(e.key==='Escape'){insert.open=false;summary.focus();}});
    }
  }
  function boot() { addSkipLink(); addConnectionLabel(); addKeyboardShortcuts(); improveLabels(); applyWorkspaceDesign(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}());
