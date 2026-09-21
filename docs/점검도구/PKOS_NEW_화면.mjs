import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const target = process.argv[2] || "http://127.0.0.1:8791/?localBridge=1";
const browserPath = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!browserPath) throw new Error("Edge 또는 Chrome을 찾지 못했습니다.");

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const profile = mkdtempSync(join(tmpdir(), "pkos-new-ui-"));
const browser = spawn(browserPath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", target,
], { stdio: "ignore" });

function stopBrowser() {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
      const marker = `--remote-debugging-port=${port}`;
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$m='${marker}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like ('*'+$m+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
    } else browser.kill();
  } catch {}
}
process.on("exit", stopBrowser);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function debuggerUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = pages.find(row => row.type === "page" && row.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error("시험 브라우저에 연결하지 못했습니다.");
}

const socket = new WebSocket(await debuggerUrl());
let messageId = 0;
const pending = new Map();
const consoleErrors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map(item => item.value ?? item.description).join(" "));
  }
};
await new Promise(resolve => { socket.onopen = resolve; });

function send(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 응답 시간 초과`)); }, 20000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "화면 평가 실패");
  return result.result.value;
}
function check(label, condition, detail = "") {
  console.log(`${condition ? "  OK  " : " FAIL "} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

const failures = [];
try {
  await send("Runtime.enable");
  await send("Page.enable");
  await wait(1800);

  const base = await evaluate(`({
    edition: document.documentElement.dataset.pkosEdition,
    navToken: getComputedStyle(document.documentElement).getPropertyValue('--pkos-nav').trim(),
    skip: !!document.querySelector('.pkos-skip'),
    search: document.querySelector('#search')?.getAttribute('aria-label') || '',
    connection: !!document.querySelector('#pkosConnection'),
    oldMetaphor: /별자리|나의 별/.test(document.body.innerText)
  })`);
  check("PKOS NEW 보강 코드가 실행된다", base.edition === "new", base.edition);
  check("탐색 폭 토큰이 적용된다", base.navToken === "220px", base.navToken);
  check("본문 건너뛰기 링크가 있다", base.skip);
  check("검색 단축키를 읽어 준다", base.search.includes("Ctrl K"), base.search);
  check("저장 위치 상태가 있다", base.connection);
  check("별자리 비유가 없다", !base.oldMetaphor);

  for (const width of [1440, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 390 });
    await wait(150);
    const view = await evaluate(`({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      navWidth: Math.round(document.querySelector('#appNav').getBoundingClientRect().width),
      headerLeft: Math.round(document.querySelector('header.top').getBoundingClientRect().left),
      connectionDisplay: getComputedStyle(document.querySelector('#pkosConnection')).display,
      paperSize: parseFloat(getComputedStyle(document.querySelector('#blocks')).fontSize)
    })`);
    check(`${width}px에서 가로 넘침이 없다`, !view.overflow, JSON.stringify(view));
    if (width === 1440) {
      check("PC 탐색 패널은 220px다", view.navWidth === 220, String(view.navWidth));
      check("PC 상단 바는 탐색 옆에서 시작한다", view.headerLeft === 220, String(view.headerLeft));
    }
    if (width === 390) {
      check("휴대폰에서 상단 바가 화면 왼쪽부터 시작한다", view.headerLeft === 0, String(view.headerLeft));
      check("휴대폰에서 중복 저장 상태를 숨긴다", view.connectionDisplay === "none", view.connectionDisplay);
      check("휴대폰 본문 글자가 16px 이상이다", view.paperSize >= 16, String(view.paperSize));
    }
  }
  await evaluate(`(()=>{const ns=pkosLocal.entries();for(let i=0;i<12;i++)ns.push({id:'graph-test-'+i,title:'분수 수업 '+i,tags:['수학'],srcPath:['수업'],blocks:[{kind:'text',text:'분수 나눗셈 수직선 분수'}],relations:[]});document.querySelector('[data-go="graph"]').click();})()`);
  await wait(400);
  check('지식맵 기본값 전체',await evaluate(`document.querySelector('[data-criterion="all"]').getAttribute('aria-pressed')==='true'`));
  check('기본 화면에는 설정 패널을 숨긴다',await evaluate(`document.querySelector('#graphSettings').hidden`));
  check('검색과 연결 기준과 화면 도구를 분리',await evaluate(`!!document.querySelector('.graph-search-row')&&!!document.querySelector('.graph-criteria-row')&&!!document.querySelector('.graph-view-tools')`));
  check('휴대폰 검색창 너비 확보',await evaluate(`document.querySelector('#graphSearch').getBoundingClientRect().width>=200`));
  await evaluate(`document.querySelector('#graphSettingsButton').click();document.querySelector('.graph-search-options').open=true`);
  check('검색 범위를 펼쳐 선택 가능',await evaluate(`document.querySelector('[data-search-scope]').getBoundingClientRect().height>0`));
  await evaluate(`document.querySelector('[aria-label="보기 설정 닫기"]').click()`);
  check('모든 기준과 별 범례 표시',await evaluate(`document.querySelectorAll('[data-criterion]').length===7&&document.querySelector('.graphlegend').textContent.includes('10각별')`));
  check('12개 글 중복 없는 66개 연결',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('연결 66개')`));
  await evaluate(`(()=>{document.querySelector('[aria-label="연결 기준"] button:last-child').click();document.querySelector('[data-criterion="direct"]').click();})()`);
  check('직접 연결 필터는 자동 연결 제외',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('연결 0개')`));
  await evaluate(`(()=>{document.querySelector('[data-criterion="folder"]').click();document.querySelector('[data-criterion="title"]').click();document.querySelector('[data-criterion="direct"]').click();})()`);
  check('폴더와 제목 중복 선택',await evaluate(`document.querySelectorAll('[data-criterion][aria-pressed="true"]').length===2&&document.querySelector('.graphmodal .mfoot').textContent.includes('연결 66개')`));
  check('일부 선택은 전체 선택에 혼합 상태 표시',await evaluate(`document.querySelector('[data-criterion="all"]').getAttribute('aria-checked')==='mixed'`));
  await evaluate(`document.querySelector('[data-criterion="all"]').click()`);
  check('전체로 다시 전환',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('연결 66개')`));
  await evaluate(`(()=>{document.querySelectorAll('[data-search-scope]').forEach(b=>{if(b.dataset.searchScope!=='title')b.click();});const input=document.querySelector('[aria-label="지식맵 검색"]');input.value='수직선';input.dispatchEvent(new Event('input'));})()`);
  check('제목 검색은 본문 일치 제외',await evaluate(`document.querySelector('[data-graph-search-results]').textContent.includes('찾은 글 0개')`));
  await evaluate(`document.querySelector('[data-search-scope="body"]').click()`);
  check('제목과 본문 중복 검색',await evaluate(`document.querySelector('[data-graph-search-results]').textContent.includes('찾은 글 12개')`));
  const shots=join(process.cwd(),'docs','design-v2');mkdirSync(shots,{recursive:true});
  async function capture(name){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,name+'.png'),Buffer.from(shot.data,'base64'));}
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="지식맵 검색"]');s.value='';s.dispatchEvent(new Event('input'));})()`);
  await capture('graph-mobile');
  for(const width of [390,768,1440]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width===390});await wait(180);
    check(width+'px 검색창은 400px 이하',await evaluate(`document.querySelector('#graphSearch').getBoundingClientRect().width<=400`));
    check(width+'px 모든 선택에 같은 체크 표시',await evaluate(`Array.from(document.querySelectorAll('.graphtools [role="checkbox"]')).every(b=>b.classList.contains('graph-check')&&b.hasAttribute('aria-checked'))`));
    await evaluate(`document.querySelectorAll('.graph-mode-tabs button')[1].click()`);await wait(100);
    check(width+'px 단어 탭과 조건 분리',await evaluate(`document.querySelectorAll('.graph-mode-tabs button')[1].getAttribute('aria-selected')==='true'&&document.querySelector('.graph-criteria-row').hidden&&document.querySelector('.graph-tuning').hidden&&!document.querySelector('.graph-word-options').hidden&&document.querySelector('.graph-search-options').hidden`));
    check(width+'px 단어 범례 표시',await evaluate(`document.querySelector('.graphlegend').textContent.includes('단어 등장 횟수')&&!document.querySelector('.graphlegend').textContent.includes('각별')`));
    await evaluate(`(()=>{const x=document.querySelector('.graph-word-options input');x.value=13;x.dispatchEvent(new Event('change'));})()`);
    check(width+'px 단어 조건이 계산에 반영',await evaluate(`document.querySelector('.graphmodal .mfoot').textContent.includes('연결 0개')`));
    await evaluate(`(()=>{const x=document.querySelector('.graph-word-options input');x.value=2;x.dispatchEvent(new Event('change'));})()`);
    check(width+'px 단어 연결 복원',await evaluate(`!document.querySelector('.graphmodal .mfoot').textContent.includes('연결 0개')`));
    await evaluate(`document.querySelector('.graph-zoom-tools button:last-child').click()`);
    check(width+'px 전체 보기는 제목까지 화면 안에 배치',await evaluate(`(()=>{const b=JSON.parse(document.querySelector('#graphCanvas').dataset.fitBounds);return b.left>=0&&b.top>=0&&b.right<=b.width&&b.bottom<=b.height-60;})()`));
    if(width===390)await capture('graph-words-mobile');
    await evaluate(`document.querySelectorAll('.graph-mode-tabs button')[0].click()`);await wait(100);
    check(width+'px 글 연결 조건 복원',await evaluate(`!document.querySelector('.graph-criteria-row').hidden&&document.querySelector('.graph-word-options').hidden&&document.querySelector('.graphmodal .mfoot').textContent.includes('연결 66개')`));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await wait(500);
  await capture('graph-desktop');
  check('지도는 창 높이의 80퍼센트 이상 사용',await evaluate(`document.querySelector('#graphCanvas').clientHeight/document.querySelector('.graphmodal').clientHeight>=.8`));
  await evaluate(`(()=>{const ns=pkosLocal.entries();for(let i=12;i<80;i++)ns.push({id:'graph-test-'+i,title:'교실에서 함께 작성한 수업 관찰과 피드백 기록 '+i,tags:['수학'],srcPath:['수업'],blocks:[{kind:'text',text:'분수 나눗셈 수직선 분수'}],relations:[]});document.querySelector('[data-criterion="all"]').click();document.querySelector('[data-criterion="all"]').click();})()`);await wait(300);
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width===390});await wait(250);
    check(width+'px 80개 기록 지도 면적 80퍼센트 이상',await evaluate(`document.querySelector('#graphCanvas').clientHeight/document.querySelector('.graphmodal').clientHeight>=.8`));
    check(width+'px 80개 기록 제목 겹침 없음',await evaluate(`(()=>{const a=JSON.parse(document.querySelector('#graphCanvas').dataset.labelBoxes);return a.length>0&&a.every((b,i)=>a.slice(i+1).every(c=>!(b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top)));})()`));
    await capture('map-workspace-80-'+width);
    await evaluate(`document.querySelector('#graphSettingsButton').click()`);await wait(80);
    check(width+'px 설정은 지도 높이를 줄이지 않는다',await evaluate(`!document.querySelector('#graphSettings').hidden&&document.querySelector('#graphCanvas').clientHeight/document.querySelector('.graphmodal').clientHeight>=.8`));
    await capture('map-settings-'+width);
    check(width+'px 설정 패널 가로 넘침 없음',await evaluate(`(()=>{const e=document.querySelector('#graphSettings');return e.scrollWidth<=e.clientWidth+1;})()`));
    await evaluate(`document.querySelector('[data-criterion="folder"]').scrollIntoView({block:'center'})`);
    check(width+'px 설정 아래쪽 기준에 접근 가능',await evaluate(`(()=>{const e=document.querySelector('[data-criterion="folder"]'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`));
    await evaluate(`document.querySelector('[aria-label="보기 설정 닫기"]').click()`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await wait(150);
  check('PWA 설치 설정과 아이콘 유지',await evaluate(`(async()=>{const m=await fetch(document.querySelector('link[rel="manifest"]').href).then(r=>r.json());return m.display==='standalone'&&(await Promise.all(m.icons.map(i=>fetch(i.src).then(r=>r.ok)))).every(Boolean)&&!!document.querySelector('#btnInstall');})()`));
  check('앱 설치 버튼 호출 경로 유지 (모의 설치 요청)',await evaluate(`(async()=>{let called=false;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{called=true;};e.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(e);document.querySelector('#btnInstall').click();await Promise.resolve();return called;})()`));
  await evaluate(`(()=>{document.querySelector('.graphmodal .mhead button').click();document.querySelector('[data-page="library"]').click();document.querySelector('#wsChip').click();})()`);await wait(250);
  await evaluate(`document.querySelector('#list .titlebtn').click()`);await wait(200);
  check('목록에서 오른쪽 읽기 패널 열기',await evaluate(`!!document.querySelector('.pkos-inline-reader')&&document.querySelector('.pkos-inline-reader').getBoundingClientRect().left===500`));
  await capture('library-desktop');
  await evaluate(`Array.from(document.querySelectorAll('.vtop button')).find(b=>b.textContent.includes('편집')).click()`);await wait(150);
  check('읽기에서 편집으로 전환',await evaluate(`!document.querySelector('.viewer')&&document.querySelector('#title').value.includes('분수 수업')`));
  check('첨부 도구는 삽입 메뉴 안에 있음',await evaluate(`document.querySelectorAll('.pkos-insert-menu [data-add]').length>=7&&!document.querySelector('.pkos-insert').open`));
  await capture('editor-desktop');
  check('제목 태그 본문 이름표 표시',await evaluate(`['title','tags'].every(id=>getComputedStyle(document.querySelector('label[for="'+id+'"]')).display!=='none')`));
  check('편집 중 저장 위치 표시',await evaluate(`!document.querySelector('#deskLine').classList.contains('hidden')`));
  check('집중 기능 제거',await evaluate(`!document.querySelector('#btnFocus')&&!document.body.classList.contains('focusing')`));
  check('상단 저장 표시와 수정 저장 문구 동기화',await evaluate(`document.querySelector('#btnSaveTop').getBoundingClientRect().height>0&&document.querySelector('#btnSaveTop').textContent===document.querySelector('#btnSave').textContent`));
  await evaluate(`document.querySelector('#btnSave').disabled=true`);await wait(30);
  check('상단 저장 중복 클릭 방지 동기화',await evaluate(`document.querySelector('#btnSaveTop').disabled`));
  await evaluate(`document.querySelector('#btnSave').disabled=false`);await wait(30);
  async function emptyPaper(){await evaluate(`(()=>{const p=document.querySelector('#blocks');p.innerHTML='<p><br></p>';p.classList.add('blank');p.focus();const r=document.createRange();r.setStart(p.firstChild,0);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);}
  async function type(text){for(const char of text)await send('Input.insertText',{text:char});}
  await emptyPaper();
  check('본문 안내 문구는 첫 문단 기준',await evaluate(`getComputedStyle(document.querySelector('#blocks'),'::before').content==='none'&&getComputedStyle(document.querySelector('#blocks p'),'::before').top==='0px'`));
  await evaluate(`document.querySelector('#blocks').dispatchEvent(new CompositionEvent('compositionstart'))`);
  await type('**한글 조합**');
  check('한글 조합 중 서식 변환 보류',await evaluate(`!document.querySelector('#blocks strong')&&document.querySelector('#blocks').textContent.includes('**한글 조합**')`));
  await evaluate(`document.querySelector('#blocks').dispatchEvent(new CompositionEvent('compositionend'))`);
  check('한글 조합 종료 후 변환',await evaluate(`document.querySelector('#blocks strong')?.textContent==='한글 조합'`));
  await emptyPaper();
  await capture('editor-empty-v3');
  await type('**굵은 글씨**');
  check('마크다운 굵게 즉시 변환',await evaluate(`document.querySelector('#blocks strong')?.textContent==='굵은 글씨'`));
  await type(' 보통 글씨');
  check('굵게 뒤 커서는 서식 밖에 있음',await evaluate(`document.querySelector('#blocks strong').textContent==='굵은 글씨'&&document.querySelector('#blocks').textContent.includes(' 보통 글씨')`));
  await type(' *기울임* ~~취소선~~ ' + '`코드`');
  check('기울임 취소선 인라인 코드',await evaluate(`['em','s','code'].every(t=>document.querySelector('#blocks '+t))`));
  await evaluate(`document.querySelector('#btnSaveTop').click()`);await wait(500);
  check('마크다운으로 저장 유지',await evaluate(`pkosLocal.entries().some(n=>n.blocks?.some(b=>b.text?.includes('**굵은 글씨**')&&b.text.includes('~~취소선~~')))`));
  await evaluate(`document.querySelector('#list .titlebtn').click()`);await wait(100);
  await evaluate(`Array.from(document.querySelectorAll('.vtop button')).find(b=>b.textContent.includes('편집')).click()`);
  await wait(350);
  check('저장 후 재편집 서식 복원',await evaluate(`document.querySelector('#blocks b, #blocks strong')?.textContent==='굵은 글씨'&&!!document.querySelector('#blocks code')`));
  for(const [prefix,selector] of [['# ','h1'],['## ','h2'],['### ','h3'],['- ','ul.pl'],['1. ','ol'],['> ','blockquote'],['[ ] ','ul.ptodo']]){
    await emptyPaper();await type(prefix);await type('입력 확인');
    check('줄 시작 '+prefix+' 변환',await evaluate(`!!document.querySelector('#blocks ${selector}')&&document.querySelector('#blocks ${selector}').textContent.includes('입력 확인')`),await evaluate(`document.querySelector('#blocks').innerHTML`));
  }
  await emptyPaper();await type('## ');await type('수업 돌아보기');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await type('**생각을 나누는 시간**과 다음 수업의 질문을 기록합니다.');
  await evaluate(`document.querySelector('#btnSave').click()`);await wait(400);
  check('제목 단계 저장',await evaluate(`pkosLocal.entries().some(n=>n.blocks?.some(b=>b.kind==='heading'&&b.level===2&&b.text==='수업 돌아보기'))`));
  await evaluate(`document.querySelector('#list .titlebtn').click()`);await wait(100);
  await evaluate(`Array.from(document.querySelectorAll('.vtop button')).find(b=>b.textContent.includes('편집')).click()`);await wait(350);
  check('제목 단계 재편집 복원',await evaluate(`document.querySelector('#blocks h2')?.textContent==='수업 돌아보기'`));
  for(const width of [1440,768,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width===390});await wait(80);
    await evaluate(`document.querySelector('#title').scrollIntoView({block:'start'})`);
    check(width+'px 편집 도구와 본문 겹침 없음',await evaluate(`document.querySelector('#blocks').getBoundingClientRect().top>=document.querySelector('#addbar').getBoundingClientRect().bottom+8`));
    check(width+'px 편집 가로 넘침 없음',await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
    await capture('editor-v3-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{document.querySelector('[data-add="fold"]').click();const a=document.querySelector('#blocks [data-kind="fold"]')||document.querySelector('#blocks .atom:last-of-type');})()`);
  const foldInputs=await evaluate(`(()=>{const t=Array.from(document.querySelectorAll('#blocks input')).find(x=>x.placeholder.includes('접었을 때'));const b=Array.from(document.querySelectorAll('#blocks textarea')).find(x=>x.placeholder.includes('펼쳤을 때'));if(!t||!b)return false;t.value='접이식 확인';b.value='펼쳐지는 본문';t.dispatchEvent(new Event('input'));b.dispatchEvent(new Event('input'));return true;})()`);
  check('접이식 편집 입력',foldInputs);
  await evaluate(`document.querySelector('#btnSaveTop').click()`);await wait(500);
  await evaluate(`document.querySelector('#list .titlebtn').click()`);await wait(200);
  check('접이식 저장 후 읽기 복원',await evaluate(`document.querySelector('.viewer details.foldbox summary')?.textContent==='접이식 확인'`));
  await evaluate(`(()=>{const d=document.querySelector('.viewer details.foldbox');d.querySelector('summary').click();})()`);
  check('접이식 펼치기 동작',await evaluate(`document.querySelector('.viewer details.foldbox').open&&document.querySelector('.viewer .foldbody').textContent.includes('펼쳐지는 본문')`));
  await evaluate(`document.querySelector('.viewer .vtop button').click()`);
  await evaluate(`document.querySelector('[data-go="settings"]').click()`);await wait(200);await capture('settings-desktop');
  check('v2 기본 구분선 적용',await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--line').trim()==='#e8e8e5'`));
  const settingTabs=await evaluate(`Array.from(document.querySelectorAll('.modal .tabs .tab')).map(b=>b.textContent)`);
  for(const label of settingTabs){await evaluate(`Array.from(document.querySelectorAll('.modal .tabs .tab')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(60);check('설정 화면 '+label,await evaluate(`!!document.querySelector('.modal .mbody').textContent.trim()`));}
  await evaluate(`document.documentElement.dataset.dark='true'`);await capture('settings-dark');
  check('어두운 화면 토큰',await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--panel').trim()==='#1f2022'`));
  await evaluate(`document.documentElement.dataset.dark='false'`);
  check("자바스크립트 오류가 없다", consoleErrors.length === 0, consoleErrors.join(" | "));
  if (failures.length) throw new Error(`PKOS NEW 화면 검사 실패 ${failures.length}개`);
  console.log("PASS PKOS NEW UI and graph");
} finally {
  try { socket.close(); } catch {}
  stopBrowser();
}
