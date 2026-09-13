import { readFileSync } from 'node:fs';
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
 await evaluate(`document.querySelector('[data-page="library"].nav-item').click()`);await wait(300);

 check('ZIP Korean filenames and extracted bytes',await evaluate(`(async()=>{const bytes=Uint8Array.from(atob('UEsDBBQAAAAAAAAAAADiw08nDAAAAAwAAAANAAAAu+fB+C+89r73LnR4dFBLT1MgYXJjaGl2ZVBLAQIUABQAAAAAAAAAAADiw08nDAAAAAwAAAANAAAAAAAAAAAAAAAAAAAAAAC758H4L7z2vvcudHh0UEsFBgAAAAABAAEAOwAAADcAAAAAAA=='),c=>c.charCodeAt(0));const files=await PKOSDocuments.extract(new Blob([bytes]));return files.length===1&&files[0].path==='사진/수업.txt'&&await files[0].blob.text()==='PKOS archive';})()`));
 check('ZIP parent path rejected',await evaluate(`(async()=>{try{await PKOSDocuments.extract(new Blob([Uint8Array.from(atob('UEsDBBQAAAAAAAAAAACDFtyMAQAAAAEAAAANAAAALi4vZXNjYXBlLnR4dHhQSwECFAAUAAAAAAAAAAAAgxbcjAEAAAABAAAADQAAAAAAAAAAAAAAAAAAAAAALi4vZXNjYXBlLnR4dFBLBQYAAAAAAQABADsAAAAsAAAAAAA='),c=>c.charCodeAt(0))]));return false;}catch(e){return e.message.includes('경로');}})()`));
 check('records start collapsed',await evaluate(`Array.from(document.querySelectorAll('.card.entry')).every(c=>!c.querySelector('.content'))`));
 await evaluate(`document.querySelector('[data-eid="photo-test"] .titlebtn').click()`);await wait(200);
 check('title expands inline preview',await evaluate(`!!document.querySelector('[data-eid="photo-test"] .content img')`));
 await evaluate(`document.querySelector('[data-eid="photo-test"] .titlebtn').click()`);
 check('title collapses',await evaluate(`!document.querySelector('[data-eid="photo-test"] .content')`));
 await evaluate(`(()=>{document.querySelector('[data-eid="photo-test"] .dots').click();Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('편집')).click();})()`);await wait(300);
 check('simplified toolbar',await evaluate(`!document.querySelector('.edbar [data-add="todo"],.edbar [data-add="list"],.edbar [data-add="source"],.edbar [data-add="code"]')`));
 await evaluate(`document.querySelector('#btnPhotoViews').click();Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='바둑판 보기').click()`);await wait(200);
 check('multiple photos grid view',await evaluate(`document.querySelectorAll('.photo-grid img').length===2`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='슬라이드 보기').click()`);
 check('multiple photos slide view',await evaluate(`document.querySelectorAll('.media-slide-stage img').length===1&&!document.querySelector('.media-slide-nav').hidden`));
 await evaluate(`document.querySelector('.media-slide-stage img').click()`);await wait(200);
 check('gallery photo opens editing studio',await evaluate(`!!document.querySelector('.maskcanvas')||!!document.querySelector('.modal canvas')`));
 await evaluate(`document.querySelector('.modal .mhead button').click()`);

 await evaluate(`document.querySelector('#blocks .pimg').click()`);
 for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('.maskpad')?.width===64`))break;await wait(100);}
 check('local photo loads in studio',await evaluate(`document.querySelector('.maskpad')?.width===64&&document.querySelector('.maskpad').height===48`));
 await evaluate(`(()=>{const cv=document.querySelector('.maskpad');window.beforePixels=cv.toDataURL();const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,pointerId:1,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));})()`);
 check('mosaic changes pixels',await evaluate(`document.querySelector('.maskpad').toDataURL()!==beforePixels`));
 await evaluate(`(()=>{Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='펜').click();const cv=document.querySelector('.maskpad');window.beforePen=cv.toDataURL();const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*.2,clientY:r.top+r.height*.2,pointerId:2,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,bubbles:true}));})()`);
 check('pen selection hides mosaic grain',await evaluate(`document.querySelector('.photo-tools [aria-pressed="true"]')?.textContent==='펜'&&document.querySelector('.grainbar').hidden&&!document.querySelector('input[aria-label="펜 색상"]').hidden`));
 check('pen changes pixels',await evaluate(`document.querySelector('.maskpad').toDataURL()!==beforePen`));

 for(const tool of ['네모','원','화살표','이모지']){
  await evaluate(`(()=>{Array.from(document.querySelectorAll('.photo-tools button')).find(b=>b.textContent==='${tool}').click();const cv=document.querySelector('.maskpad'),r=cv.getBoundingClientRect();window.shapeBefore=cv.toDataURL();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*.25,clientY:r.top+r.height*.25,pointerId:4,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width*.75,clientY:r.top+r.height*.75,pointerId:4,bubbles:true}));cv.dispatchEvent(new PointerEvent('pointerup',{pointerId:4,bubbles:true}));})()`);
  check('photo '+tool+' draws',await evaluate(`document.querySelector('.maskpad').toDataURL()!==shapeBefore`));
  await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent.includes('한 번 되돌리기')).click()`);
  check('photo '+tool+' undo restores pixels',await evaluate(`document.querySelector('.maskpad').toDataURL()===shapeBefore`));
 }
 await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent.includes('다 됐습니다')).click()`);await wait(250);
 check('photo returns to editor',await evaluate(`!document.querySelector('.maskpad')&&!!document.querySelector('#blocks .pimg')`));
 // File input exercises new-photo naming without writing any personal file.
 await evaluate(`document.getElementById('title').value='Photo title'`);
 await send('DOM.enable');let root=await send('DOM.getDocument');let inp=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#imgInput'});
 await send('DOM.setFileInputFiles',{nodeId:inp.nodeId,files:[process.argv[3]]});await wait(200);
 await evaluate(`document.querySelector('[data-incoming-save]')?.click()`);await wait(700);
 check('photo filename uses current title',await evaluate(`document.getElementById('blocks').textContent.includes('Photo title.png')`));
 // Audio import commits just one attachment, retaining unsaved text and record count.
 await evaluate(`window.recordCount=pkosLocal.entries().length;document.querySelector('[data-add="voice"]').click()`);await wait(200);
 root=await send('DOM.getDocument');inp=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'.modal input[type="file"]'});
 await send('DOM.setFileInputFiles',{nodeId:inp.nodeId,files:[process.argv[4]]});await wait(300);
 check('audio duration is finite',await evaluate(`(()=>{const a=document.querySelector('.modal audio');return Number.isFinite(a.duration)&&Math.abs(a.duration-1)<.1;})()`));
 await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='녹음 파일 첨부').click()`);await wait(300);
 check('audio does not save whole draft or add transcript',await evaluate(`pkosLocal.entries().length===recordCount&&!document.getElementById('blocks').textContent.includes('전사 확인')&&document.getElementById('btnSave').textContent==='수정 저장'`));
 // Markdown typed into ordinary text converts on explicit save.
 await evaluate(`(()=>{const p=document.getElementById('blocks');p.appendChild(document.createElement('div')).textContent='## Markdown heading';p.appendChild(document.createElement('div')).textContent='- Markdown item';document.getElementById('btnSave').click();})()`);await wait(800);
 check('Markdown saved as heading/list',await evaluate(`(()=>{const n=pkosLocal.entries().find(n=>n.id==='photo-test');return n.blocks.some(b=>b.kind==='heading'&&b.text.includes('Markdown heading'))&&n.blocks.some(b=>b.kind==='list');})()`));
 // Responsive viewport bounds and no new script exceptions.
 for(const width of [390,768,1024,1280,1920]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await wait(120);check('viewport '+width,await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));}
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await wait(350);
 await evaluate(`(()=>{const ns=pkosLocal.entries();ns.push({...ns[0],id:'trash-fixture',trashed:true,localMissing:false,mdId:null,srcId:null,blocks:[]});document.getElementById('typeFilters').querySelector('button').click();const b=Array.from(document.querySelectorAll('.smartrow')).find(b=>b.textContent.includes('휴지통'));b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:100}));})()`);
 check('trash bulk context actions',await evaluate(`document.querySelector('.menupop').textContent.includes('전체 복원')&&document.querySelector('.menupop').textContent.includes('전체 삭제')`));
 await evaluate(`Array.from(document.querySelectorAll('.menupop button')).find(b=>b.textContent.includes('전체 복원')).click()`);await wait(200);
 check('trash bulk restore',await evaluate(`!pkosLocal.entries().find(n=>n.id==='trash-fixture').trashed`));

 const code=readFileSync('index.html','utf8');const wavCode=code.slice(code.indexOf('  async function recordingWav('),code.indexOf('  function fixAudioDuration('));
 check('recorded WebM converted with correct duration',await evaluate(`(async()=>{${wavCode}
 const ctx=new AudioContext(),osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination();osc.connect(out);osc.start();await ctx.resume();const rec=new MediaRecorder(out.stream),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);const done=new Promise(r=>rec.onstop=r);rec.start();await new Promise(r=>setTimeout(r,1100));rec.stop();await done;osc.stop();await ctx.close();const wav=await recordingWav(new Blob(chunks,{type:rec.mimeType}));const bytes=await wav.arrayBuffer();const v=new DataView(bytes);const seconds=v.getUint32(40,true)/v.getUint32(28,true);return wav.type==='audio/wav'&&seconds>.8&&seconds<1.6;
 })()`));

 await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('UEsDBBQAAAAAAAAAAADiw08nDAAAAAwAAAANAAAAu+fB+C+89r73LnR4dFBLT1MgYXJjaGl2ZVBLAQIUABQAAAAAAAAAAADiw08nDAAAAAwAAAANAAAAAAAAAAAAAAAAAAAAAAC758H4L7z2vvcudHh0UEsFBgAAAAABAAEAOwAAADcAAAAAAA=='),c=>c.charCodeAt(0))],'자료.zip',{type:'application/zip'}));const input=document.getElementById('fileInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('[data-incoming-save]')`))break;await wait(100);}
 await evaluate(`document.querySelector('[data-incoming-save]').click()`);await wait(700);
 check('ZIP upload inserts extracted attachment',await evaluate(`document.getElementById('blocks').textContent.includes('수업.txt')&&!document.getElementById('blocks').textContent.includes('자료.zip')`));

 await evaluate(`(()=>{const paper=document.getElementById('blocks'),p=document.createElement('p');p.textContent='출처: https://www.youtube.com/watch?v=qN0-ysftSbc';paper.appendChild(p);paper.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(800);
 check('plain source URL shows YouTube preview',await evaluate(`!!document.querySelector('#textLinkPreviews .lc-thumb[src*="qN0-ysftSbc"]')`));
 await evaluate(`document.querySelector('[data-add="link"]').click()`);await wait(100);
 await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('#blocks input')).find(i=>i.placeholder==='https://…');input.value='https://example.com/';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(700);
 check('website link input shows preview card',await evaluate(`!!document.querySelector('#blocks .linkcard[href="https://example.com/"]')`));

 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{window.captureFixtures=[];window.makeCaptureFixture=()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,320,180);const stream=c.captureStream(15);window.captureFixtures.push(stream);setTimeout(()=>{ctx.fillStyle='blue';ctx.fillRect(20,20,80,60);},50);return Promise.resolve(stream);};navigator.mediaDevices.getDisplayMedia=makeCaptureFixture;navigator.mediaDevices.getUserMedia=makeCaptureFixture;})()`);
 for(const captureName of ['화면 캡처하기','웹캠으로 찍기']){
  await evaluate(`document.querySelector('[data-add="capture"]').click();Array.from(document.querySelectorAll('.sheetbtn')).find(b=>b.textContent.includes('${captureName}')).click()`);
  if(captureName==='웹캠으로 찍기'){
    for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('.camview')?.videoWidth>0`))break;await wait(100);}
    await evaluate(`Array.from(document.querySelectorAll('.modal .mfoot button')).find(b=>b.textContent.includes('찍기')).click()`);
  }
  for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('.maskpad')?.width===320`))break;await wait(100);}
  check(captureName+' opens full photo tools',await evaluate(`document.querySelector('.maskpad')?.width===320&&['모자이크','펜','네모','원','화살표','이모지'].every(label=>Array.from(document.querySelectorAll('.photo-tools button')).some(b=>b.textContent===label))`));
  check(captureName+' releases media stream',await evaluate(`captureFixtures.at(-1).getTracks().every(t=>t.readyState==='ended')`));
  await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='자르기').click()`);await wait(150);
  check(captureName+' crop has one purpose',await evaluate(`document.querySelector('.modal h3').textContent==='사진 자르기'&&!document.querySelector('.modal').textContent.includes('모자이크로 가리기')`));
  await evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='전체 사용').click()`);
  for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('.photo-tools')`))break;await wait(100);}
  check(captureName+' returns to full editor after crop',await evaluate(`!!document.querySelector('.photo-tools')`));
  await evaluate(`document.querySelector('.modal .mhead button').click()`);
 }

 await evaluate(`(()=>{
  window.lectureStreams=[];window.lectureTimers=[];
  window.fakeVideo=(color)=>{const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');let f=0;const paint=()=>{ctx.fillStyle=color;ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.fillText(String(f++),10,20);};paint();lectureTimers.push(setInterval(paint,50));const s=c.captureStream(20);lectureStreams.push(s);return s;};
  navigator.mediaDevices.getDisplayMedia=async()=>fakeVideo('blue');
  navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'test-mic',label:'시험 마이크'}];
  navigator.mediaDevices.getUserMedia=async options=>{window.lastMicConstraints=options.audio;if(window.lectureAudio){lectureOsc.stop();await lectureAudio.close();}window.lectureAudio=new AudioContext();const osc=lectureAudio.createOscillator(),dest=lectureAudio.createMediaStreamDestination();osc.connect(dest);osc.start();window.lectureOsc=osc;const s=options.video?fakeVideo('red'):new MediaStream();s.addTrack(dest.stream.getAudioTracks()[0]);return s;};
  window.SpeechRecognition=class{start(){setTimeout(()=>{const line=[{transcript:'강의 시험 문장'}];line.isFinal=true;this.onresult?.({resultIndex:0,results:[line]});},100);}stop(){}};
  PKOSLecture.open({title:'강의 시험',target:{id:null},attach:async data=>{window.lectureResult=data;}});
 })()`);
 await wait(100);
 await evaluate(`document.querySelector('#lectureRecorder select').value='test-mic';Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='마이크 확인 (3초)').click()`);
 await wait(700);
 check('microphone test shows input level',await evaluate(`document.querySelector('#lectureRecorder meter').value>0`));
 await wait(2800);
 check('microphone selected device constraint',await evaluate(`lastMicConstraints.deviceId.exact==='test-mic'`));
 check('microphone test playback contains sound',await evaluate(`(async()=>{const a=document.querySelector('#lectureRecorder audio'),c=new AudioContext();try{const b=await(await fetch(a.src)).arrayBuffer(),decoded=await c.decodeAudioData(b);return !a.hidden&&decoded.duration>2&&decoded.getChannelData(0).some(v=>Math.abs(v)>.01);}finally{await c.close();}})()`));
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='녹화 시작').click()`);
 for(let i=0;i<70;i++){if(await evaluate(`!Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='녹화 종료').hidden`))break;await wait(100);}
 check('lecture screen and face composite',await evaluate(`(()=>{const c=document.querySelector('#lectureRecorder canvas'),ctx=c.getContext('2d'),screen=ctx.getImageData(100,100,1,1).data,face=ctx.getImageData(1100,600,1,1).data;return screen[2]>200&&face[0]>200&&face[2]<50;})()`));
 await wait(1500);
 check('lecture timestamped transcript',await evaluate(`document.querySelector('#lectureRecorder textarea').value.includes('[0:')&&document.querySelector('#lectureRecorder textarea').value.includes('강의 시험 문장')`));
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='일시 정지').click()`);
 check('lecture pauses',await evaluate(`!!Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='계속 녹화')`));
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='계속 녹화').click()`);await wait(800);
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='녹화 종료').click()`);
 for(let i=0;i<70;i++){if(await evaluate(`!Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='기록에 넣기').hidden`))break;await wait(100);}
 check('lecture releases screen and mic',await evaluate(`lectureStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))`));
 // Close without attaching and recover persisted chunks from a new recorder panel.
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='닫기').click();PKOSLecture.open({title:'복구',attach:async data=>{window.lectureResult=data;}})`);
 for(let i=0;i<40;i++){if(await evaluate(`!!Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent.startsWith('이전 녹화 복구'))`))break;await wait(100);}
 check('lecture recovery offered',await evaluate(`!!Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent.startsWith('이전 녹화 복구'))`));
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent.startsWith('이전 녹화 복구')).click()`);await wait(200);
 await evaluate(`Array.from(document.querySelectorAll('#lectureRecorder button')).find(b=>b.textContent==='기록에 넣기').click()`);await wait(300);
 check('lecture recovered video and transcript attach',await evaluate(`lectureResult.blob.size>1000&&lectureResult.blob.type.startsWith('video/')&&lectureResult.text.includes('강의 시험 문장')&&lectureResult.seconds>1`));
 check('lecture recorded audio decodes',await evaluate(`(async()=>{const c=new AudioContext();try{const audio=await c.decodeAudioData(await lectureResult.blob.arrayBuffer());return audio.duration>1&&audio.getChannelData(0).some(v=>Math.abs(v)>.01);}finally{await c.close();}})()`));
 await evaluate(`lectureTimers.forEach(clearInterval);lectureOsc.stop();lectureAudio.close()`);
 // Exercise the actual editor attachment hook after the lecture's draft has been saved.
 await evaluate(`(()=>{window.realLectureOpen=PKOSLecture.open;PKOSLecture.open=hooks=>window.editorLectureHooks=hooks;document.getElementById('title').value='강의 중 메모';document.querySelector('[data-add="lecture"]').click();document.getElementById('btnSave').click();PKOSLecture.open=realLectureOpen;})()`);await wait(600);
 await evaluate(`editorLectureHooks.attach({...lectureResult,id:'lecture-editor-fixture',target:editorLectureHooks.target})`);await wait(300);
 check('lecture attaches to notes saved during recording',await evaluate(`pkosLocal.entries().some(n=>n.title==='강의 중 메모'&&n.blocks.some(b=>b.lectureId==='lecture-editor-fixture')&&n.blocks.some(b=>(b.text||'').includes('강의 전사')))`));
 await evaluate(`editorLectureHooks.attach({...lectureResult,id:'lecture-editor-fixture',target:editorLectureHooks.target})`);
 check('lecture attachment retry does not duplicate',await evaluate(`pkosLocal.entries().flatMap(n=>n.blocks||[]).filter(b=>b.lectureId==='lecture-editor-fixture').length===1`));
 check('no exceptions',errors.length===0,errors.join(';'));
 console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
}finally{ws.close();edge.kill();}
