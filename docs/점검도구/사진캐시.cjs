const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('index.html','utf8');for(const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=|application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
const start=s.indexOf('  var imageLoads ='),end=s.indexOf('\n  /* ---------- 사진 슬라이드',start);
let reads=0,revoked=[],timers=[],cleanup,imgs=[];
const c={Map,Set,Promise,Array,Error,imgUrlCache:{},localIsId:()=>true,localReadFile:async()=>{reads++;return{}},setInterval:f=>cleanup=f,setTimeout:f=>timers.push(f),URL:{createObjectURL:()=> 'blob:'+reads,revokeObjectURL:u=>revoked.push(u)},document:{querySelectorAll:()=>imgs}};
vm.createContext(c);vm.runInContext(s.slice(start,end),c);
function img(){let i={dataset:{},src:'',isConnected:true,removeAttribute(){this.src=''},addEventListener(){},getAttribute(){return this.src}};imgs.push(i);return i;}
(async()=>{let a=img(),b=img();c.loadDriveImage('local:a',a);c.loadDriveImage('local:a',b);await new Promise(setImmediate);assert.equal(reads,1);assert.equal(a.src,b.src);c.invalidateImage('local:a');cleanup();assert.equal(revoked.length,0);imgs=[];cleanup();assert.equal(revoked.length,1);
let d=img();c.localReadFile=async()=>{reads++;throw Error('offline')};c.loadDriveImage('local:missing',d);await new Promise(setImmediate);for(let i=0;i<3;i++){timers.splice(0).forEach(f=>f());await new Promise(setImmediate)}assert.equal(reads,4);assert(d.alt.includes('다시 시도'));assert(s.includes('.composer-actions { position: static;'));console.log('PASS: shared read, visible URL retention, detached URL cleanup, bounded retry, save bar flow, inline syntax');})();
