// Isolated browser fixture. Google requests are mocked; no account or user files are used.
import {createServer} from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
function fixture(mode){
  const records=mode==='deleted'?[{id:'gone',title:'삭제된 파일',mdId:'gone-file',srcPath:['옛 폴더']},{id:'kept',title:'현재 파일',mdId:'kept-file',srcPath:['잘못된 옛 위치']},{id:'denied',title:'권한 확인이 필요한 파일',mdId:'denied-file'}]:[];
  records.forEach(n=>Object.assign(n,{tags:[],blocks:[{kind:'text',id:n.id+'-body',text:'가상 검증 본문'}],createdAt:1,updatedAt:1}));
  return `(()=>{
const mode=${JSON.stringify(mode)}, records=${JSON.stringify(records)};
let revision=0;
document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('button');b.id='fixture-change';b.textContent='외부 파일 추가·수정·이동 모의';b.style='position:fixed;bottom:10px;left:10px;z-index:99999;background:white;color:black';b.onclick=()=>{revision++;b.textContent='외부 변경 완료 · 자동 반영 대기';};document.body.appendChild(b);});
if(sessionStorage.getItem('fixture')!==mode){
 Object.keys(localStorage).filter(k=>k.startsWith('pkos.')).forEach(k=>localStorage.removeItem(k));
 sessionStorage.setItem('fixture',mode);
 localStorage.setItem('pkos.entries.v2',JSON.stringify(records));
 localStorage.setItem('pkos.folder',JSON.stringify({id:'fixture-root',name:'현재 연결 폴더'}));
 localStorage.setItem('pkos.connected','1');
 localStorage.setItem('pkos.email','fixture@example.invalid');
 localStorage.setItem('pkos.token.v1',JSON.stringify({t:'fixture-only',exp:Date.now()+3600000}));
 localStorage.setItem('pkos.desk.v1',JSON.stringify({id:'stale-desk',name:'존재하지 않는 예전 저장 위치',path:['존재하지 않는 예전 저장 위치']}));
 localStorage.setItem('pkos.deskList.v1',localStorage.getItem('pkos.desk.v1').replace(/^/,'[')+']');
 if(mode==='orphan')localStorage.setItem('pkos.draft.v1',JSON.stringify({editingId:'missing-record',title:'이전 브라우저 초안',blocks:[{id:'draft-body',kind:'text',text:'보존해야 하는 초안 본문'}],savedAt:1}));
}
const realFetch=window.fetch.bind(window);const reply=(x,status=200)=>Promise.resolve(new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}}));
window.fetch=(input,options={})=>{
 const u=new URL(typeof input==='string'?input:input.url,location.href);
 if(!u.hostname.endsWith('googleapis.com'))return realFetch(input,options);
 if(options.method&&options.method!=='GET')return reply({error:{message:'Fixture blocks writes'}},403);
 if(u.pathname.includes('userinfo'))return reply({email:'fixture@example.invalid'});
 const id=u.pathname.split('/').pop(),q=u.searchParams.get('q')||'';
 if(id==='fixture-root')return reply({id,name:'현재 연결 폴더',mimeType:'application/vnd.google-apps.folder'});
 if(id==='fixture-index')return u.searchParams.get('alt')==='media'?reply({entries:records,deleted:[]}):reply({version:'1',modifiedTime:'2026-09-21'});
 if(id==='files'){
  if(q.includes("name='PKOS-index.json'"))return reply({files:[{id:'fixture-index',name:'PKOS-index.json'}]});
  if(q.includes('name=' )||q.includes('name contains'))return reply({files:[]});
  if(mode==='deleted'&&q.includes("'fixture-root'"))return reply({files:[{id:'real-dir',name:revision?'변경된 실제 폴더':'실제 폴더',mimeType:'application/vnd.google-apps.folder'}]});
  if(mode==='deleted'&&q.includes("'real-dir'"))return reply({files:[{id:'kept-file',name:revision?'변경된 파일.md':'현재 파일.md',mimeType:'text/markdown',modifiedTime:revision?'2026-09-21T01:00:00Z':'2026-09-21T00:00:00Z'},...(revision?[{id:'new-file',name:'새 파일.md',mimeType:'text/markdown',modifiedTime:'2026-09-21T01:00:00Z'}]:[])]});
  return reply({files:[]});
 }
 if(id==='gone-file')return reply({error:{message:'not found'}},404);
 if(id==='denied-file')return reply({error:{message:'permission denied'}},403);
 if((id==='kept-file'||id==='new-file')&&u.searchParams.get('alt')==='media')return Promise.resolve(new Response('# '+(id==='new-file'?'새로 추가한 파일':revision?'외부에서 바뀐 제목':'현재 파일')+'\\n'+(revision?'실시간으로 바뀐 본문':'가상 검증 본문')));
 return reply({id,name:id,trashed:false});
};
})();`;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
 const file=resolve(root,name);
 if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
 let bytes=readFileSync(file);
 if(name==='index.html'){
  const mode=url.searchParams.get('fixture')||'orphan';
  bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>'+fixture(mode)+'</script>').replace(/<script[^>]+src="https:\/\/accounts\.google[^>]*><\/script>/g,''));
 }
 if(name==='sw.js'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
}).listen(8143,'127.0.0.1',()=>console.log('Isolated PKOS fixture: http://127.0.0.1:8143/?fixture=orphan or ?fixture=deleted'));
