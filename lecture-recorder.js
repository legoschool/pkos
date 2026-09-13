/* PKOS lecture recording. Video checkpoints live in IndexedDB; browser speech recognition may use its provider network. */
(function(){
'use strict';
let active=null;
function el(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n;}
function button(text,fn){const b=el('button',text);b.type='button';b.className='btn sm';b.onclick=fn;return b;}
const time=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pkos-lectures',1);r.onupgradeneeded=()=>{r.result.createObjectStore('sessions',{keyPath:'id'});r.result.createObjectStore('chunks');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function transaction(db,stores,fn){return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');fn(tx);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장 중단'));});}
function read(db,store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function remove(db,m){await transaction(db,['sessions','chunks'],tx=>{tx.objectStore('sessions').delete(m.id);for(let i=0;i<m.count;i++)tx.objectStore('chunks').delete(m.id+':'+i);});}
async function videoBlob(db,m){const chunks=[];for(let i=0;i<m.count;i++){const b=await read(db,'chunks',m.id+':'+i);if(!b)throw Error('녹화 조각을 찾지 못했습니다.');chunks.push(b);}return new Blob(chunks,{type:m.mime||'video/webm'});}
function open(hooks){
 if(active){active.scrollIntoView();return;}
 const panel=el('section');active=panel;panel.id='lectureRecorder';panel.setAttribute('aria-label','강의 녹화');
 panel.style.cssText='position:fixed;right:16px;bottom:76px;width:min(420px,calc(100vw - 24px));max-height:82vh;overflow:auto;z-index:190;background:var(--panel);color:var(--ink);border:1px solid var(--line-soft);border-radius:12px;box-shadow:0 6px 28px #0004;padding:14px;';
 const head=el('div');head.style.cssText='display:flex;align-items:center;gap:8px';head.append(el('strong','강의 녹화'));const clock=el('span','0:00');clock.style.marginLeft='auto';head.append(clock);
 const body=el('div'),status=el('p'),preview=el('canvas');preview.width=1280;preview.height=720;preview.style.cssText='width:100%;background:#111;border-radius:8px;margin-top:8px';preview.hidden=true;
 const title=el('input');title.className='inp';title.placeholder='강의 제목';title.value=hooks.title||'';title.setAttribute('aria-label','강의 제목');
 const options=el('div');options.style.cssText='display:flex;gap:12px;flex-wrap:wrap;margin:10px 0';
 function option(label,checked){const wrap=el('label'),input=el('input');input.type='checkbox';input.checked=checked;wrap.append(input,document.createTextNode(' '+label));options.append(wrap);return input;}
 const face=option('내 얼굴',true),system=option('화면 소리',false),transcribe=option('한국어 전사',true);
 const micBox=el('div'),mic=el('select'),meter=el('meter'),micStatus=el('p'),micPlayback=el('audio');
 mic.className='inp';mic.setAttribute('aria-label','마이크 선택');const defaultMic=el('option','기본 마이크');defaultMic.value='';mic.append(defaultMic);
 meter.min=0;meter.max=100;meter.value=0;meter.setAttribute('aria-label','마이크 입력 크기');meter.style.width='100%';micPlayback.controls=true;micPlayback.hidden=true;micPlayback.style.width='100%';
 const micTest=button('마이크 확인 (3초)',testMic);micBox.append(el('label','마이크'),mic,micTest,meter,micStatus,micPlayback);
 let micNodes=[],meterTimer,probeStream,probeAudio,probeRecorder,probeTimer,probeUrl,probeVersion=0;
 const micConstraints=()=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(mic.value?{deviceId:{exact:mic.value}}:{})});
 async function listMics(selected=mic.value){const devices=await navigator.mediaDevices.enumerateDevices();if(!panel.isConnected)return;mic.replaceChildren(defaultMic);devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>{const o=el('option',d.label||'마이크 '+(i+1));o.value=d.deviceId;mic.append(o);});if(Array.from(mic.options).some(o=>o.value===selected))mic.value=selected;}
 function monitor(context,stream){const track=stream.getAudioTracks()[0];if(!track||track.readyState!=='live')throw Error('마이크 음성 트랙이 없습니다. 다른 마이크를 선택하세요.');const source=context.createMediaStreamSource(new MediaStream([track])),analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);micNodes.push(source,analyser);const samples=new Float32Array(analyser.fftSize);let lastSound=performance.now();clearInterval(meterTimer);meterTimer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length);meter.value=Math.min(100,rms*400);if(rms>.003)lastSound=performance.now();micStatus.textContent=track.muted?'마이크가 음소거되었습니다.':context.state!=='running'?'마이크 처리 일시 중단':performance.now()-lastSound>5000?'입력 소리가 없습니다. 마이크와 음소거를 확인하세요.':(track.label||'선택한 마이크')+' 입력 중';},150);}
 function stopProbe(){probeVersion++;clearTimeout(probeTimer);clearInterval(meterTimer);if(probeRecorder?.state==='recording')probeRecorder.stop();probeRecorder=null;probeStream?.getTracks().forEach(t=>t.stop());probeStream=null;probeAudio?.close().catch(()=>{});probeAudio=null;micNodes=[];meter.value=0;micTest.disabled=false;}
 mic.onchange=()=>{stopProbe();micPlayback.hidden=true;micStatus.textContent='';};
 async function testMic(){if(state!=='idle')return;stopProbe();const version=probeVersion;micTest.disabled=true;micStatus.textContent='마이크에 짧게 말해 주세요.';try{probeAudio=new (window.AudioContext||window.webkitAudioContext)();await probeAudio.resume();const stream=await navigator.mediaDevices.getUserMedia({video:false,audio:micConstraints()});if(version!==probeVersion||!panel.isConnected){stream.getTracks().forEach(t=>t.stop());return;}probeStream=stream;await listMics(mic.value);monitor(probeAudio,stream);const chunks=[];const recorder=new MediaRecorder(stream);probeRecorder=recorder;recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{if(version!==probeVersion)return;if(probeUrl)URL.revokeObjectURL(probeUrl);probeUrl=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));micPlayback.src=probeUrl;micPlayback.hidden=false;stopProbe();micStatus.textContent='재생 버튼으로 녹음된 목소리를 확인하세요.';};recorder.start();probeTimer=setTimeout(()=>recorder.stop(),3000);}catch(e){if(version!==probeVersion)return;stopProbe();micStatus.textContent='마이크 확인 실패: '+e.message;}}
 listMics().catch(()=>{});
 const transcript=el('textarea');transcript.className='inp';transcript.rows=4;transcript.placeholder='전사';transcript.setAttribute('aria-label','강의 전사');
 const controls=el('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
 const start=button('녹화 시작',begin),pause=button('일시 정지',togglePause),stopButton=button('녹화 종료',finish),save=button('기록에 넣기',attach),download=button('영상 저장',downloadVideo);
 pause.hidden=stopButton.hidden=save.hidden=download.hidden=true;start.classList.add('primary');controls.append(start,pause,stopButton,save,download);
 const recover=el('div');body.append(title,options,micBox,preview,status,transcript,controls,recover);
 let minimized=false;head.append(button('접기',e=>{minimized=!minimized;body.hidden=minimized;e.target.textContent=minimized?'펼치기':'접기';}));
 head.append(button('닫기',()=>{if(state==='recording'||state==='paused'){finish();return;}if(state==='starting'||state==='saving')return;cleanup();if(probeUrl)URL.revokeObjectURL(probeUrl);panel.remove();active=null;}));panel.append(head,body);document.body.append(panel);
 let db,meta,rec,state='idle',streams=[],audio,drawTimer,clockTimer,queue=Promise.resolve(),result=null,fallback=[],recognition=null,recognitionWanted=false,recognitionRetry,started=0,pausedAt=0,pausedTotal=0,finalizing=false,attached=false;
 const elapsed=()=>Math.max(0,((pausedAt||performance.now())-started-pausedTotal)/1000);
 function checkpoint(){if(!meta)return;meta.text=transcript.value;meta.title=title.value.trim()||'강의 기록';meta.seconds=elapsed();}
 function keep(chunk){if(!chunk.size)return;queue=queue.then(async()=>{if(fallback.length){fallback.push(chunk);return;}checkpoint();const next={...meta,count:meta.count+1};try{await transaction(db,['sessions','chunks'],tx=>{tx.objectStore('chunks').put(chunk,meta.id+':'+meta.count);tx.objectStore('sessions').put(next);});meta=next;}catch(e){fallback.push(chunk);status.textContent='임시 저장 공간이 부족합니다. 영상을 내려받아 보관하세요.';finish();}});}
 function stopSpeech(){recognitionWanted=false;clearTimeout(recognitionRetry);try{recognition?.stop();}catch(_){}recognition=null;}
 function speech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!transcribe.checked)return;if(!SR){status.textContent='이 브라우저는 실시간 전사를 지원하지 않습니다. 녹화는 계속됩니다.';return;}
  recognitionWanted=true;recognition=new SR();recognition.lang='ko-KR';recognition.continuous=true;recognition.interimResults=false;
  recognition.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal){transcript.value+=(transcript.value?'\n':'')+'['+time(elapsed())+'] '+e.results[i][0].transcript;}checkpoint();};
  recognition.onerror=e=>{status.textContent='전사: '+e.error+' (녹화는 계속됩니다)';if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error))recognitionWanted=false;};
  recognition.onend=()=>{if(recognitionWanted&&state==='recording')recognitionRetry=setTimeout(()=>{try{recognition.start();}catch(_){}},500);};
  try{recognition.start();}catch(e){status.textContent='전사를 시작하지 못했습니다. 녹화는 계속됩니다.';}
 }
 async function begin(){
  if(state!=='idle')return;
  if(!navigator.mediaDevices?.getDisplayMedia||!window.MediaRecorder){status.textContent='PC Chrome 또는 Edge에서 강의 녹화를 열어 주세요.';return;}
  stopProbe();state='starting';start.disabled=true;mic.disabled=micTest.disabled=true;recover.hidden=true;
  try{
   // Ask for screen directly from the click so browser activation is preserved.
   const screen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:system.checked});streams.push(screen);
   const camera=await navigator.mediaDevices.getUserMedia({video:face.checked?{width:640,height:360}:false,audio:micConstraints()});streams.push(camera);
   db=await database();
   async function play(stream){const v=el('video');v.muted=true;v.playsInline=true;v.srcObject=stream;await v.play();return v;}
   const screenVideo=await play(screen),faceVideo=face.checked?await play(camera):null;
   audio=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();monitor(audio,camera);await listMics(mic.value);const destination=audio.createMediaStreamDestination();
   [screen,camera].forEach(stream=>{if(stream.getAudioTracks().length){const source=audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));source.connect(destination);micNodes.push(source);}});
   const ctx=preview.getContext('2d');
   function draw(){ctx.fillStyle='#111';ctx.fillRect(0,0,1280,720);const scale=Math.min(1280/screenVideo.videoWidth,720/screenVideo.videoHeight);const w=screenVideo.videoWidth*scale,h=screenVideo.videoHeight*scale;if(w&&h)ctx.drawImage(screenVideo,(1280-w)/2,(720-h)/2,w,h);if(faceVideo&&faceVideo.videoWidth){const w=280,h=158,x=980,y=542;ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();const k=Math.max(w/faceVideo.videoWidth,h/faceVideo.videoHeight);ctx.drawImage(faceVideo,x+(w-faceVideo.videoWidth*k)/2,y+(h-faceVideo.videoHeight*k)/2,faceVideo.videoWidth*k,faceVideo.videoHeight*k);ctx.restore();ctx.strokeStyle='white';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);}}
   draw();drawTimer=setInterval(draw,33);const canvasStream=preview.captureStream(30);streams.push(canvasStream);const mixed=new MediaStream([...canvasStream.getVideoTracks(),...(screen.getAudioTracks().length?destination.stream.getAudioTracks():camera.getAudioTracks())]);streams.push(destination.stream);
   const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));rec=new MediaRecorder(mixed,mime?{mimeType:mime,videoBitsPerSecond:2500000}:undefined);
   meta={id:'lecture-'+Date.now()+'-'+Math.random().toString(36).slice(2),count:0,title:title.value.trim()||'강의 기록',text:'',seconds:0,mime:rec.mimeType,state:'recording',createdAt:Date.now(),target:hooks.target};
   await transaction(db,['sessions'],tx=>tx.objectStore('sessions').put(meta));rec.ondataavailable=e=>keep(e.data);rec.onstop=finalize;rec.onerror=e=>{status.textContent='녹화 오류. 저장된 부분을 보존합니다.';finish();};
   started=performance.now();state='recording';rec.start(1000);speech();
   screen.getVideoTracks()[0].addEventListener('ended',finish);camera.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{status.textContent='마이크 연결이 끊겼습니다.';finish();}));
   title.disabled=true;[face,system,transcribe].forEach(n=>n.disabled=true);start.hidden=true;pause.hidden=stopButton.hidden=false;preview.hidden=false;clockTimer=setInterval(()=>clock.textContent=time(elapsed()),500);window.addEventListener('beforeunload',guard);
  }catch(e){cleanup();state='idle';start.disabled=false;mic.disabled=micTest.disabled=false;recover.hidden=false;status.textContent='녹화를 시작하지 못했습니다: '+e.message;}
 }
 function guard(e){e.preventDefault();e.returnValue='';}
 function cleanup(){stopProbe();clearInterval(drawTimer);clearInterval(clockTimer);stopSpeech();streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));streams=[];if(audio){audio.close().catch(()=>{});audio=null;}window.removeEventListener('beforeunload',guard);}
 function togglePause(){if(state==='recording'){pausedAt=performance.now();rec.pause();state='paused';pause.textContent='계속 녹화';stopSpeech();}else if(state==='paused'){pausedTotal+=performance.now()-pausedAt;pausedAt=0;rec.resume();state='recording';pause.textContent='일시 정지';speech();}}
 function finish(){if(!['recording','paused'].includes(state))return;checkpoint();state='saving';pause.disabled=stopButton.disabled=true;stopSpeech();if(rec.state!=='inactive')rec.stop();else finalize();}
 async function finalize(){if(finalizing)return;finalizing=true;cleanup();window.addEventListener('beforeunload',guard);state='saving';status.textContent=status.textContent||'녹화를 저장하고 있습니다.';try{await queue;meta.text=transcript.value;meta.state='done';result=new Blob([await videoBlob(db,meta),...fallback],{type:meta.mime});try{await transaction(db,['sessions'],tx=>tx.objectStore('sessions').put(meta));}catch(e){status.textContent='임시 저장 실패. 영상을 내려받아 보관하세요.';}state='done';pause.hidden=stopButton.hidden=true;save.hidden=download.hidden=false;status.textContent=fallback.length?'임시 저장 공간 부족. 영상을 내려받아 보관하세요.':'녹화 완료';transcript.disabled=false;title.disabled=false;}catch(e){status.textContent='녹화 보존 중 오류: '+e.message;state='done';}finally{window.removeEventListener('beforeunload',guard);}}
 async function attach(){if(!result||state!=='done')return;save.disabled=true;try{if(!attached)await hooks.attach({blob:result,title:title.value.trim()||meta.title,text:transcript.value,seconds:meta.seconds,id:meta.id,target:meta.target});attached=true;await remove(db,meta);if(probeUrl)URL.revokeObjectURL(probeUrl);panel.remove();active=null;}catch(e){status.textContent='기록 저장 실패: '+e.message;save.disabled=false;}}
 function downloadVideo(){if(!result)return;const url=URL.createObjectURL(result),a=el('a');a.href=url;a.download=(title.value||meta.title).replace(/[\\/:*?"<>|]/g,'_')+(meta.mime.includes('mp4')?'.mp4':'.webm');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 database().then(d=>{db=d;const r=d.transaction('sessions').objectStore('sessions').getAll();r.onsuccess=()=>{r.result.filter(m=>m.count>0).forEach(m=>recover.append(button('이전 녹화 복구: '+m.title,async()=>{try{meta=m;result=await videoBlob(db,m);title.value=m.title;transcript.value=m.text||'';state='done';start.hidden=options.hidden=true;recover.hidden=true;save.hidden=download.hidden=false;clock.textContent=time(m.seconds||0);status.textContent='저장된 녹화를 복구했습니다.';}catch(e){status.textContent=e.message;}})));};}).catch(e=>{status.textContent='임시 저장소를 열지 못했습니다: '+e.message;});
}
window.PKOSLecture={open};
})();
