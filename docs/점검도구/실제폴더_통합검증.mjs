import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
const app=resolve(import.meta.dirname,'../..'),root=join(app,'00_테스트 파일 생성');
const manifest=JSON.parse(readFileSync(join(root,'테스트자료_목록.json'),'utf8'));
const base=process.argv[2]||'http://127.0.0.1:8792';
const uploadTitle='가상_파일선택_'+Date.now();
const status=await fetch(base+'/api/status').then(r=>r.json());
if(status.name!=='PKOS_검증_20260920')throw Error('테스트 폴더가 아니므로 중단');
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{let p=s.address().port;s.close(()=>r(p));});});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),'pkos-full-'))}`,base+'/?localBridge=1'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws,seq=0;const pending=new Map(),errors=[],results=[],requests=[],networkFailures=[];
function stop(){try{spawnSync('taskkill',['/PID',String(edge.pid),'/T','/F'],{stdio:'ignore'});}catch{}}
process.on('exit',stop);
function send(method,params={}){let id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{let t=setTimeout(()=>{pending.delete(id);rej(Error(method+' timeout'));},45000);pending.set(id,{res:v=>{clearTimeout(t);res(v);},rej:e=>{clearTimeout(t);rej(e);}});});}
async function ev(expression){let r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
function check(name,ok,detail=''){results.push({name,ok,detail});console.log((ok?'OK ':'FAIL ')+name+' '+JSON.stringify(detail));}
async function poll(expression){for(let i=0;i<100;i++){if(await ev(expression))return true;await wait(150);}return false;}
async function search(q){await ev(`(()=>{const q=document.querySelector('#search');q.value=${JSON.stringify(q)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(1200);}
try{
 let pages;for(let i=0;i<100;i++){try{pages=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());if(pages.some(p=>p.type==='page'&&p.webSocketDebuggerUrl))break;}catch{}await wait(100);}
 ws=new WebSocket(pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl).webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 ws.onmessage=e=>{let m=JSON.parse(e.data);if(pending.has(m.id)){let p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(Error(m.error.message)):p.res(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);if(m.method==='Network.loadingFailed')networkFailures.push(m.params);};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 check('실제 테스트 폴더 연결',await poll('window.pkosLocal?.isOn()'),await ev(`({url:location.href,title:document.title,body:document.body.innerText.slice(0,220),script:document.scripts.length})`));
 await wait(3000);
 await ev(`pkosLocal.importAll(null,{quiet:true})`);await wait(800);
 let entries=await ev(`pkosLocal.entries().filter(n=>!n.trashed&&!n.localMissing).map(n=>({id:n.id,title:n.title,path:n.mdId,blocks:n.blocks.map(b=>({kind:b.kind,name:b.name,fileId:b.fileId,text:b.text}))}))`);
 check('30개 이상 실제 자료 불러오기',entries.length>=30,entries.length);
 check('가상 기록 20개 보존',Array.from({length:20},(_,i)=>String(i+1).padStart(2,'0')+'_가상기록').every(t=>entries.some(n=>n.title===t)));
 check('같은 제목 다른 경로 구분',entries.filter(n=>n.title==='01_가상기록').length===2);
 check('스크립트 실행 방지',!await ev('window.__fixtureExecuted'));
 await ev(`document.querySelector('[data-page="library"]').click()`);await wait(800);
 const start=requests.length;const countBefore=await ev(`pkosLocal.entries().length`);await ev(`pkosLocal.importAll(null,{quiet:true})`);
 const scans=requests.slice(start).filter(u=>u.includes('/api/file?')&&!decodeURIComponent(u).match(/\.md(?:$|&)|PKOS-/i));
 check('목록 재검사에서 첨부 본문 재다운로드 없음',scans.length===0,scans.map(decodeURIComponent));
 check('폴더 재읽기 기록 중복 없음',await ev(`pkosLocal.entries().length`)===countBefore);
 await ev(`document.querySelector('[data-page="library"]').click()`);
 for(const [q,min]of [['본문검색_분수실험',1],['동명이름_구별토큰',1],['긴본문끝_검증토큰',1],['워드 본문 확인',1],['공유 문자열',1],['hello',1],['절대로없는검색어_314159',0]]){
  await search(q);if(min)await poll(`document.querySelectorAll('#list .entry').length>=${min}`);let count=await ev(`document.querySelectorAll('#list .entry').length`);check('검색 '+q,min?count>=min:count===0,count);
 }
 const supported=manifest.files.filter(f=>/\.(docx|xlsx|pptx|hwpx|odt|ods|odp|zip)$/i.test(f.name));
 for(const f of supported){let r=await ev(`(async()=>{try{const blob=await(await fetch('/api/file?path='+encodeURIComponent(${JSON.stringify(f.name)}))).blob();const result=await PKOSDocuments.read(blob,${JSON.stringify(f.name)});return {ok:true,text:JSON.stringify(result).slice(0,100)};}catch(e){return {ok:false,error:e.message};}})()`);check('문서 파서 '+f.name,f.kind==='invalid-expected'||/broken\./.test(f.name)?!r.ok:r.ok,r);}
 check('정상 PDF 본문 검색',await ev(`(async()=>{const b=await(await fetch('/api/file?path='+encodeURIComponent('첨부/텍스트.pdf'))).blob();return PKOSPdf.contains(b,'hello');})()`));
 check('손상 PDF 실패 처리',await ev(`(async()=>{const b=await(await fetch('/api/file?path='+encodeURIComponent('경계/손상.pdf'))).blob();return PKOSPdf.contains(b,'hello').then(()=>false,()=>true);})()`));
 for(const q of ['텍스트.pdf','sample.docx','테스트.png','시험음']){
  await search(q);let exists=await ev(`!!document.querySelector('#list .titlebtn')`);check('첨부 목록 '+q,exists);if(!exists)continue;
  await ev(`document.querySelector('#list .titlebtn').click()`);await wait(800);
  check('첨부 읽기 화면 '+q,await ev(`!!document.querySelector('.viewer')`));
  if(q==='텍스트.pdf')check('PDF 화면 그리기',await poll(`!!document.querySelector('.viewer [data-pdf-rendered="1"] canvas')`));
  if(q==='시험음'){await ev(`document.querySelector('.viewer .playbtn')?.click()`);check('오디오 재생 가능',await poll(`document.querySelector('.viewer audio')?.readyState>=2`));}
  await ev(`document.querySelector('.viewer .vtop button').click()`);
 }
 // Edit only the explicitly synthetic note and check actual disk persistence.
 await search('02_가상기록');await ev(`document.querySelector('#list .titlebtn').click()`);await wait(150);
 await ev(`Array.from(document.querySelectorAll('.vtop button')).find(b=>b.textContent.includes('편집')).click()`);await wait(350);
 await ev(`(()=>{const p=document.querySelector('#blocks');p.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);})()`);
 await send('Input.insertText',{text:' 실제폴더저장_재열기토큰'});await ev(`document.querySelector('#btnSave').click()`);await wait(1200);
 check('실제 Markdown 파일에 저장',readFileSync(join(manifest.suite,'기록/02_가상기록.md'),'utf8').includes('실제폴더저장_재열기토큰'));
 check('밑줄 포함 원문 보존',readFileSync(join(manifest.suite,'기록/02_가상기록.md'),'utf8').includes('본문검색_분수실험'));
 await send('Page.reload',{ignoreCache:true});check('재접속 연결',await poll('window.pkosLocal?.isOn()'));await wait(1000);
 check('재열기 내용 유지',await ev(`pkosLocal.entries().some(n=>n.blocks.some(b=>(b.text||'').includes('실제폴더저장_재열기토큰')))`));
 // Generate actual encoded image/video fixtures in the browser, within the test root only.
 check('JPEG WebP WebM 생성',await ev(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#325778';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('PKOS TEST',30,80);async function put(name,blob){const r=await fetch('/api/file?path='+encodeURIComponent('첨부/'+name),{method:'PUT',headers:{'X-PKOS-Local':'1'},body:blob});if(!r.ok)throw Error('fixture save '+r.status);}for(const [ext,mime]of [['jpg','image/jpeg'],['webp','image/webp']]){const blob=await new Promise(r=>c.toBlob(r,mime));await put('브라우저그림.'+ext,blob);}const stream=c.captureStream(5),rec=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);const done=new Promise(r=>rec.onstop=r);rec.start();await new Promise(r=>setTimeout(r,600));ctx.fillText('Second frame',30,120);await new Promise(r=>setTimeout(r,500));rec.stop();await done;stream.getTracks().forEach(t=>t.stop());await put('시험영상.webm',new Blob(chunks,{type:'video/webm'}));return true;})()`));
 await ev(`pkosLocal.importAll(null,{quiet:true})`);await ev(`document.querySelector('[data-page="library"]').click()`);await search('시험영상');
 await ev(`document.querySelector('#list .titlebtn').click()`);await wait(300);await ev(`document.querySelector('.viewer .playbtn')?.click()`);check('동영상 프레임 읽기',await poll(`document.querySelector('.viewer video')?.readyState>=2`),await ev(`document.querySelector('.viewer video')?{src:document.querySelector('.viewer video').src,error:document.querySelector('.viewer video').error?.message}:document.querySelector('.viewer').innerText.slice(-200)`));await ev(`document.querySelector('.viewer .vtop button').click()`);
 // Native multi-file picker: attachments go to a new synthetic note only.
 await search('');await ev(`document.querySelector('#topNew').click()`);await wait(350);
 await ev(`document.querySelector('#title').value=${JSON.stringify(uploadTitle)}`);
 await send('DOM.enable');const dom=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#fileInput'});
 await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:['첨부/공백 파일.txt','첨부/테스트.png','첨부/텍스트.pdf','첨부/시험음.wav'].map(f=>join(manifest.suite,f))});
 check('첨부 저장 이름 확인창',await poll(`!!document.querySelector('[data-incoming-save]')`));
 await ev(`document.querySelector('[data-incoming-save]').click()`);
 check('파일 선택 4개 입력',await poll(`document.querySelectorAll('#blocks .atom').length>=4`));
 await ev(`document.querySelector('#btnSave').click()`);await wait(1500);
 check('선택한 첨부 저장',await poll(`pkosLocal.entries().some(n=>n.title===${JSON.stringify(uploadTitle)}&&n.blocks.filter(b=>b.fileId).length>=4)`));
 check('첨부 기록 Markdown 저장 완료',await poll(`pkosLocal.entries().some(n=>n.title===${JSON.stringify(uploadTitle)}&&n.mdId&&!n._dirty&&n.blocks.filter(b=>b.fileId).length>=4)`));
 const saved=await ev(`pkosLocal.entries().find(n=>n.title===${JSON.stringify(uploadTitle)}&&n.blocks.filter(b=>b.fileId).length>=4).blocks.filter(b=>b.fileId).map(b=>b.fileId.slice(6))`);
 const sourceHashes=['첨부/공백 파일.txt','첨부/테스트.png','첨부/텍스트.pdf','첨부/시험음.wav'].map(f=>createHash('sha256').update(readFileSync(join(manifest.suite,f))).digest('hex'));
 check('첨부 4개 실제 파일 바이트 일치',saved.every(f=>sourceHashes.includes(createHash('sha256').update(readFileSync(join(manifest.suite,f))).digest('hex'))));
 await send('Page.reload',{ignoreCache:true});await poll('window.pkosLocal?.isOn()');await wait(3000);
 check('첨부 4개 재접속 후 유지',await ev(`pkosLocal.entries().some(n=>n.title===${JSON.stringify(uploadTitle)}&&n.blocks.filter(b=>b.fileId).length>=4)`));
 await ev(`document.querySelector('[data-page="library"]').click()`);
 for(const q of ['09_가상기록','페이지.html','알수없는형식']){
   await search(q);await ev(`document.querySelector('#list .titlebtn').click()`);await wait(400);
   check('링크 또는 지원외 형식 화면 '+q,await ev(`!!document.querySelector('.viewer')`));
   if(q==='페이지.html')check('HTML 격리 미리보기',await ev(`document.querySelector('.viewer iframe')?.hasAttribute('sandbox')`));
   if(q==='알수없는형식')check('미지원 형식 안내',await ev(`document.querySelector('.viewer').textContent.includes('아직 내용 미리보기를 지원하지 않습니다')`));
   await ev(`document.querySelector('.viewer .vtop button').click()`);
 }
 await search('');await ev(`document.querySelector('[data-go="graph"]').click()`);await wait(300);
 check('실제 자료 지식맵 표시',await ev(`!!document.querySelector('#graphCanvas')&&document.querySelectorAll('[data-criterion]').length===7`));
 await ev(`document.querySelector('.graphmodal .mhead button').click()`);
 check('런타임 예외 없음',errors.length===0,errors);
 let unchanged=manifest.files.filter(f=>f.name!=='기록/02_가상기록.md').every(f=>existsSync(join(manifest.suite,f.name))&&createHash('sha256').update(readFileSync(join(manifest.suite,f.name))).digest('hex')===f.sha256);
 check('편집 대상 외 원본 바이트 보존',unchanged);
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await ev(`document.querySelector('[data-page="library"]').click()`);await wait(300);
 let shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(root,'실제폴더_검증화면.png'),Buffer.from(shot.data,'base64'));
}catch(e){check('검사 실행 완료',false,String(e.stack||e));}
finally{writeFileSync(join(root,'실제폴더_검증결과.json'),JSON.stringify({at:new Date().toISOString(),base,results,errors,networkFailures},null,2));try{ws.close();}catch{}stop();}
if(results.some(r=>!r.ok))process.exitCode=1;
