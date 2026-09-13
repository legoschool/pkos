import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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


try {
 for(let i=0;i<60;i++){if(await evaluate('window.pkosLocal?.isOn()'))break;await wait(200);}
 check('new default has no selected record type',await evaluate(`!document.querySelector('#typeChips .on')`));
 check('untagged import does not infer folder tags',await evaluate(`pkosLocal.entries().find(n=>n.id==='untagged-source').tags.length===0`));
 await evaluate(`pkosLocal.entries().find(n=>n.id==='untagged-source').tags=['삭제한태그'];pkosLocal.importAll(null,{quiet:false})`);
 check('cached deleted tag reconciles without mtime change',await evaluate(`pkosLocal.entries().find(n=>n.id==='untagged-source').tags.length===0&&!document.querySelector('#sideNav').textContent.includes('삭제한태그')`));
 check('startup editor',await evaluate(`document.body.dataset.page==='library'`));
 await evaluate(`document.getElementById('btnHome').click()`);await wait(200);
 check('brand opens knowledge home',await evaluate(`document.body.dataset.page==='home'&&document.getElementById('homePage').textContent.includes('연결이 많은 기록')&&document.getElementById('homePage').textContent.includes('전체 자료')`));
 check('todo navigation removed',await evaluate(`!document.querySelector('[data-go="todo"]')&&!Array.from(document.querySelectorAll('.smartrow')).some(b=>b.textContent.includes('할 일'))`));
 const source=readFileSync('index.html','utf8');const algorithm=source.slice(source.indexOf('  function knowledgeAnalysis('),source.indexOf('  function isInbox('));
 check('shared words and frequencies',await evaluate(`(()=>{${algorithm};const ns=[{id:'a',title:'수업 질문',blocks:[{text:'수업 질문 질문'}]},{id:'b',title:'수업 질문',blocks:[]},{id:'c',title:'바다 여행',blocks:[]}];const a=knowledgeAnalysis(ns);return a.edges.length===1&&a.edges[0].words.includes('질문')&&a.degree.get('a')===1&&a.words.find(x=>x[0]==='질문')[1]===4;})()`));
 await evaluate(`(()=>{const ns=pkosLocal.entries(),base=ns[0];ns.push({...base,id:'analysis-a',title:'수업 질문',blocks:[{kind:'text',text:'수업 질문 평가'}],tags:['현재태그']},{...base,id:'analysis-b',title:'수업 질문',blocks:[{kind:'text',text:'수업 질문 평가'}],tags:['현재태그']},{...base,id:'analysis-deleted',trashed:true,tags:['삭제태그']},{...base,id:'analysis-missing',_missing:true,tags:['사라진태그']});document.querySelector('[data-page="library"]').click();document.querySelector('[data-go="graph"]').click();})()`);await wait(300);
 check('graph excludes deleted tags',await evaluate(`(()=>{Array.from(document.querySelectorAll('.graphtools button')).find(b=>b.textContent.includes('태그')).click();return !document.querySelector('.modal').textContent.includes('삭제태그');})()`));
 check('sidebar excludes missing tags',await evaluate(`!document.querySelector('#sideNav').textContent.includes('사라진태그')&&!document.querySelector('#sideNav').textContent.includes('삭제태그')`));
 await evaluate(`Array.from(document.querySelectorAll('.graphtools button')).find(b=>b.textContent==='단어 관계망').click()`);await wait(250);
 check('word network opens',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('단어')&&!!document.querySelector('#graphCanvas')`));
 for(const width of [390,768,1280]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await wait(200);check('graph viewport '+width,await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));}
 await evaluate(`document.querySelector('.graphmodal .mhead button').click();document.querySelector('#webTools button').click()`);
 check('site form has title and URL only',await evaluate(`document.querySelectorAll('.modal input').length===2&&!document.querySelector('.modal textarea,.modal a')&&!document.querySelector('.modal').textContent.includes('기록에 넣기')`));
 await evaluate(`window.siteDraftBefore=document.querySelector('#blocks').innerHTML;document.querySelector('[aria-label="사이트 주소"]').value='javascript:alert(1)';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='사이트 추가').click()`);
 check('unsafe URL rejected',await evaluate(`document.querySelector('.modal').textContent.includes('http 또는 https')`));
 await evaluate(`document.querySelector('[aria-label="사이트 주소"]').value='https://example.com/';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='사이트 추가').click()`);
 check('site requires title',await evaluate(`document.querySelector('.modal').textContent.includes('사이트 제목을 입력')`));
 await evaluate(`document.querySelector('[aria-label="사이트 제목"]').value='사이트 시험';Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='사이트 추가').click()`);
 check('site shortcut stored without changing draft',await evaluate(`document.querySelector('#webTools a').href==='https://example.com/'&&document.querySelector('#blocks').innerHTML===siteDraftBefore`));
 await evaluate(`document.querySelector('[data-go="settings"]').click();Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='저장 위치').click()`);
 check('only per record folders',await evaluate(`document.querySelector('.modal .mbody').textContent.includes('기록 제목으로 폴더 생성')&&!document.querySelector('.modal .mbody').textContent.includes('태그별로')&&!document.querySelector('.modecard')`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='저장').click();document.querySelector('[data-go="settings"]').click();Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='저장 위치').click()`);
 check('per record folder setting persists',await evaluate(`document.querySelector('.modal .mbody').textContent.includes('기록 제목으로 폴더 생성')&&!document.querySelector('.modal .mbody').textContent.includes('태그별로')`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.querySelector('[data-add="capture"]').click()`);
 check('capture has buttons only',await evaluate(`!document.querySelector('.sheetnote,.sheetbtn small,.sheettoggle')&&!document.querySelector('.modal').textContent.includes('클립보드')`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.getElementById('btnHome').click()`);await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await wait(200);
 mkdirSync('local-service/runtime',{recursive:true});writeFileSync('local-service/runtime/knowledge-home.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await wait(200);check('home mobile viewport',await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));writeFileSync('local-service/runtime/knowledge-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 check('catalog lists all current records',await evaluate(`document.querySelectorAll('.knowledge-card').length===pkosLocal.entries().filter(n=>!n.trashed&&!n.localMissing&&!n._missing&&!n._away).length`));
 await evaluate(`document.getElementById('btnFeedback').click()`);check('feedback without contact or diagnostics',await evaluate(`!document.getElementById('fbWho')&&!document.querySelector('.fbmeta')&&!!document.getElementById('fbText')`));
 check('feedback icon and label visible',await evaluate(`!!document.querySelector('#btnFeedback svg')&&getComputedStyle(document.querySelector('#btnFeedback .fbl')).display!=='none'`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.getElementById('btnHelp').click()`);check('menu without tutorial prose',await evaluate(`!document.querySelector('.modal').textContent.includes('백링크')&&document.querySelector('.modal').textContent.includes('전체 자료')`));
 check('inbox removed from navigation',await evaluate(`!Array.from(document.querySelectorAll('.smartrow')).some(b=>b.textContent.includes('미정리함'))&&getComputedStyle(document.querySelector('.inboxline')).display==='none'`));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.querySelector('[data-go="settings"]').click()`);
 for(const name of ['모양','저장 위치','가져오기','태그','파일 이름','의견 받기','고급']){await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent.includes('${name}')).click()`);check('settings tab '+name,await evaluate(`!!document.querySelector('.modal .mbody')`));}
 await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent.includes('가져오기')).click()`);check('local import enabled without Google',await evaluate(`Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent==='폴더 다시 읽기'&&!b.disabled)&&Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent==='파일 가져오기'&&!b.disabled)`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='폴더 다시 읽기').click()`);await wait(500);check('local import button recovers',await evaluate(`!Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='폴더 다시 읽기').disabled`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='태그').click()`);
 check('tag presets visible',await evaluate(`document.querySelector('.modal [aria-label="빠른 선택 태그"]').value.includes('연수')&&!document.querySelector('.modal input[name="defaultRecordType"]')`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='파일 이름').click()`);check('naming shows optional tag rule',await evaluate(`document.querySelector('.modal .mbody').textContent.includes('폴더명-태그(선택)-파일명')&&!document.querySelector('input[name="recordNameRule"]')`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='저장').click();document.querySelector('[data-go="settings"]').click();Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='파일 이름').click()`);check('naming setting persists',await evaluate(`document.querySelector('.modal .mbody').textContent.includes('태그 미설정')`));
 await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='모양').click()`);
 check('five font and five size choices',await evaluate(`['아주 작음','작음','보통','크게','아주 크게','고딕','명조','시스템','굴림','고정폭'].every(t=>Array.from(document.querySelectorAll('.picklabel')).some(x=>x.textContent===t))`));
 await evaluate(`Array.from(document.querySelectorAll('.pickbtn')).find(b=>b.querySelector('.picklabel')?.textContent==='작음').click();Array.from(document.querySelectorAll('.pickbtn')).find(b=>b.querySelector('.picklabel')?.textContent==='명조').click();window.fontBefore=getComputedStyle(document.querySelector('#homePage h1')).fontFamily;window.sizeBefore=getComputedStyle(document.querySelector('#homePage h1')).fontSize;Array.from(document.querySelectorAll('.tonebtn')).find(b=>b.textContent.includes('남색')).click()`);
 check('palette preserves font and size',await evaluate(`getComputedStyle(document.querySelector('#homePage h1')).fontFamily===fontBefore&&getComputedStyle(document.querySelector('#homePage h1')).fontSize===sizeBefore&&document.documentElement.dataset.size==='small'`));
 await evaluate(`Array.from(document.querySelectorAll('.pickbtn')).find(b=>b.querySelector('.picklabel')?.textContent==='어둡게').click()`);
 check('dark palette cards',await evaluate(`getComputedStyle(document.querySelector('.tonebtn')).backgroundColor!=='rgb(255, 255, 255)'`));
 await evaluate(`document.querySelector('#title').value='기본 유형 검사 초안';document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}))`);await wait(500);
 await evaluate(`Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='태그').click();document.querySelector('[aria-label="빠른 선택 태그"] input')?.click();Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='저장').click();document.querySelector('#topNew').click()`);
 await evaluate(`(()=>{const old=window.confirm;window.confirm=()=>true;try{document.querySelector('#btnCancelEdit').click();}finally{window.confirm=old;}})()`);
 check('new record still has no tags after settings save',await evaluate(`!document.querySelector('#typeChips .on')&&document.querySelector('#tags').value===''`));
 await evaluate(`document.querySelector('[data-go="settings"]').click();Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='모양').click()`);
 check('font size and face persist',await evaluate(`document.documentElement.dataset.font==='serif'&&document.documentElement.dataset.size==='small'`));
 await evaluate(`Array.from(document.querySelectorAll('.pickbtn')).find(b=>b.querySelector('.picklabel')?.textContent==='아주 크게').click();Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent==='닫기').click()`);check('cancel reverts preview',await evaluate(`document.documentElement.dataset.size==='small'`));
 await evaluate(`document.querySelector('#wsChip').click()`);check('workspace opens records not settings',await evaluate(`!document.querySelector('.modal')&&document.body.dataset.page==='library'`));
 await evaluate(`(()=>{var ns=pkosLocal.entries();ns.push({...ns[0],id:'folder-one',srcPath:['선택가'],localDir:'선택가',tags:['선택가']},{...ns[0],id:'folder-two',srcPath:['선택나'],localDir:'선택나',tags:['선택나']},{...ns[0],id:'folder-three',srcPath:['선택다'],localDir:'선택다',tags:['선택다']});document.querySelector('#wsChip').click();})()`);
 await evaluate(`(()=>{let rows=Array.from(document.querySelectorAll('[data-select-folder]')).filter(b=>b.dataset.selectFolder.includes('선택'));if(rows.length<3){document.querySelector('.siderow .sidetog')?.click();rows=Array.from(document.querySelectorAll('[data-select-folder]')).filter(b=>b.dataset.selectFolder.includes('선택'));}if(rows.length<3)throw Error('folder fixture missing');rows[0].click();rows=Array.from(document.querySelectorAll('[data-select-folder]')).filter(b=>b.dataset.selectFolder.includes('선택'));rows[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));})()`);
 check('Ctrl selects two folders',await evaluate(`Array.from(document.querySelectorAll('[data-select-folder][aria-pressed="true"]')).filter(b=>b.dataset.selectFolder.includes('선택')).length===2`));
 await evaluate(`(()=>{let rows=Array.from(document.querySelectorAll('[data-select-folder]')).filter(b=>b.dataset.selectFolder.includes('선택'));rows[0].click();rows=Array.from(document.querySelectorAll('[data-select-folder]')).filter(b=>b.dataset.selectFolder.includes('선택'));rows[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));})()`);
 check('Shift selects folder range',await evaluate(`Array.from(document.querySelectorAll('[data-select-folder][aria-pressed="true"]')).filter(b=>b.dataset.selectFolder.includes('선택')).length===3`));
 await evaluate(`document.querySelector('[data-go="settings"]').click();Array.from(document.querySelectorAll('.modal .tab')).find(b=>b.textContent==='모양').click()`);await wait(100);
 writeFileSync('local-service/runtime/appearance-dark.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(`document.querySelector('.modal .mhead button').click();document.querySelector('[data-add="capture"]').click()`);check('capture follows dark palette',await evaluate(`getComputedStyle(document.querySelector('.sheetbtn')).backgroundColor==='rgb(37, 42, 50)'`));

 await evaluate(`document.querySelector('.modal .mhead button').click();document.querySelector('[data-add="draw"]').click()`);await wait(200);
 check('all tools visible and handwriting renamed',await evaluate(`!document.querySelector('#btnAddMore')&&document.querySelector('[data-add="draw"]').textContent==='필기'&&getComputedStyle(document.querySelector('[data-add="table"]')).display!=='none'`));
 check('writing defaults to thick pen with three eraser sizes',await evaluate(`Array.from(document.querySelectorAll('.modal .primary')).some(b=>b.textContent==='굵게')&&['지우개 작게','지우개 보통','지우개 크게','전체 지우기'].every(t=>Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent===t))`));
 await evaluate(`window.strokeTest=(points)=>{const c=document.querySelector('.drawpad'),r=c.getBoundingClientRect();c.setPointerCapture=()=>{};for(let i=0;i<points.length;i++)c.dispatchEvent(new PointerEvent(i===0?'pointerdown':'pointermove',{clientX:r.x+points[i][0]*r.width,clientY:r.y+points[i][1]*r.height,pointerId:1,bubbles:true}));c.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));};window.inkPixels=()=>{const c=document.querySelector('.drawpad'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<220)n++;return n;};strokeTest([[.2,.5],[.8,.5]]);window.inkBefore=inkPixels();`);
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='지우개 작게').click();strokeTest([[.5,.5]]);window.smallErase=inkBefore-inkPixels();Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent.includes('한 획 되돌리기')).click();Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='지우개 크게').click();strokeTest([[.5,.5]]);window.largeErase=inkBefore-inkPixels();`);
 check('larger eraser removes more pixels',await evaluate(`largeErase>smallErase&&smallErase>0`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='전체 지우기').click()`);
 check('clear all empties canvas',await evaluate(`inkPixels()===0`));

 await evaluate(`window.ocrCheck=(async()=>{await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)});let worker;try{worker=await Tesseract.createWorker('kor+eng');const c=document.createElement('canvas');c.width=800;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,200);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText('PKOS NOTE 123',30,110);const r=await worker.recognize(c);window.ocrResult=r.data.text;}catch(e){window.ocrResult='ERROR '+e.message;}finally{if(worker)await worker.terminate();}})()`);
 for(let i=0;i<90;i++){if(await evaluate(`typeof window.ocrResult==='string'`))break;await wait(1000);}
 check('real Korean English OCR engine recognizes text',await evaluate(`(window.ocrResult||'').includes('PKOS')&&(window.ocrResult||'').includes('123')`),await evaluate(`window.ocrResult||'timeout'`));
 await evaluate(`document.querySelector('.modal .mhead button').click()`);

 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.querySelector('[data-page="library"]').click()`);await wait(300);
 await evaluate(`window.toggleBefore=document.querySelector('#btnListFold').getBoundingClientRect().toJSON();document.querySelector('#btnListFold').click()`);await wait(300);
 check('list toggle stays in place',await evaluate(`(()=>{const r=document.querySelector('#btnListFold').getBoundingClientRect();return Math.abs(r.x-toggleBefore.x)<1&&Math.abs(r.y-toggleBefore.y)<1;})()`));
 await evaluate(`document.querySelector('#btnListFold').click()`);
 check('storage shown once with clear local label',await evaluate(`document.querySelector('#storageChip').textContent.startsWith('저장 위치: 로컬 폴더')&&getComputedStyle(document.querySelector('#wsChip')).display==='none'&&document.querySelector('#banner').hidden`));
 check('new record has no folder dropdown',await evaluate(`!document.querySelector('#topNewMore')&&!!document.querySelector('#topNew')&&!document.querySelector('#deskLine button')`));
 check('site shortcut matches sidebar menu',await evaluate(`document.querySelector('#webTools > button').classList.contains('nav-item')`));

 await evaluate(`document.querySelector('#btnCancelEdit').click();document.querySelector('#title').value='태그 저장 검사';const input=document.querySelector('#tagEntry');input.value='게임';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));`);
 check('new record has no tags',await evaluate(`document.querySelector('#tags').value===''&&document.querySelectorAll('#tagChips .chip').length===0`));
 check('Korean composition does not commit tags',await evaluate(`document.querySelector('#tags').value===''&&document.querySelector('#tagEntry').value==='게임'`));
 await evaluate(`document.querySelector('#tagEntry').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('#tagEntry').value='#게임, 게이미피케이션';document.querySelector('#tagAdd').click()`);
 check('tag add normalizes and deduplicates',await evaluate(`document.querySelector('#tags').value==='게임, 게이미피케이션'&&document.querySelectorAll('#tagChips .chip').length===2`));
 await evaluate(`document.querySelector('[aria-label="게임 태그 삭제"]').click();document.querySelector('#tagEntry').value='게임';document.querySelector('#btnSave').click()`);await wait(700);
 await evaluate(`const card=Array.from(document.querySelectorAll('.entry')).find(c=>c.textContent.includes('태그 저장 검사'));card.querySelector('.dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('편집')).click()`);
 check('selected tag appears in new record filename',await evaluate(`pkosLocal.entries().find(n=>n.title==='태그 저장 검사').mdName.includes('-게이미피케이션-')`));
 check('tags survive save and reopen including pending input',await evaluate(`document.querySelector('#tags').value==='게이미피케이션, 게임'&&document.querySelectorAll('#tagChips .chip').length===2`));
 await evaluate(`document.querySelector('[aria-label="게이미피케이션 태그 삭제"]').click();document.querySelector('#tagEntry').value='게이미';document.querySelector('#tagEntry').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#tagSuggestions button').click()`);
 check('tag suggestion selects one full tag',await evaluate(`document.querySelector('#tags').value==='게임, 게이미피케이션'&&document.querySelector('#tagEntry').value===''`));
 await evaluate(`Array.from(document.querySelectorAll('#tagChips button')).forEach(b=>b.click());document.querySelector('#btnSave').click()`);await wait(800);
 check('record saves with all tags removed',await evaluate(`pkosLocal.entries().find(n=>n.title==='태그 저장 검사').tags.length===0`));
 check('empty tag does not leave double separators',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.title==='태그 저장 검사');return !!n.mdName&&!n.mdName.includes('--')&&!n.mdName.includes('태그없음');})()`));
 await evaluate(`document.querySelector('#btnCancelEdit').click();document.querySelector('#typeChips .on')?.click();document.querySelector('#title').value='유형 미선택 저장 시험';document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}));`);
 check('record type can be deselected',await evaluate(`!document.querySelector('#typeChips .on')`));
 await evaluate(`document.querySelector('#btnSave').click()`);await wait(700);
 check('unselected record type saves without material fallback',await evaluate(`pkosLocal.entries().find(n=>n.title==='유형 미선택 저장 시험').type===''`));
 await send('Page.reload');await wait(2400);
 check('unselected type survives folder reload',await evaluate(`pkosLocal.entries().find(n=>n.title==='유형 미선택 저장 시험')?.type===''`));
 await evaluate(`document.querySelector('#btnCancelEdit').click();document.querySelector('#title').value='태그 통합 저장 검사';const buttons=Array.from(document.querySelectorAll('#typeChips button'));buttons.find(b=>b.textContent==='연수').click();buttons.find(b=>b.textContent==='아이디어')?.click();`);
 // Query again after the first toggle rerenders the button group.
 await evaluate(`if(!document.querySelector('#tags').value.includes('아이디어'))Array.from(document.querySelectorAll('#typeChips button')).find(b=>b.textContent==='아이디어').click()`);
 check('former types select multiple real tags',await evaluate(`document.querySelector('#tags').value==='연수, 아이디어'&&document.querySelectorAll('#tagChips .chip').length===2`));
 await evaluate(`document.querySelector('[aria-label="연수 태그 삭제"]').click()`);
 check('tag removal updates quick selection',await evaluate(`!Array.from(document.querySelectorAll('#typeChips button')).find(b=>b.textContent==='연수').classList.contains('on')`));
 await evaluate(`document.querySelector('#btnSave').click()`);await wait(800);
 check('unified tag is saved in filename and record',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.title==='태그 통합 저장 검사');return n.type===''&&n.tags.join(',')==='아이디어'&&n.mdName.includes('-아이디어-');})()`));
 await send('Page.reload');await wait(2400);
 check('legacy type becomes tag once',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.id==='photo-test');return n.type===''&&n.tags.filter(t=>t==='자료').length===1;})()`));
 check('unified tags survive reconnect',await evaluate(`pkosLocal.entries().find(n=>n.title==='태그 통합 저장 검사').tags.join(',')==='아이디어'`));
 await evaluate(`const card=Array.from(document.querySelectorAll('.entry')).find(c=>c.textContent.includes('Photo'));card.querySelector('.dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('편집')).click();document.querySelector('[aria-label="자료 태그 삭제"]').click();document.querySelector('#btnSave').click()`);await wait(800);
 await send('Page.reload');await wait(2400);
 check('deleted migrated type tag stays deleted',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.id==='photo-test');return n.type===''&&!n.tags.includes('자료');})()`));
 check('no exceptions' ,errors.length===0,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
