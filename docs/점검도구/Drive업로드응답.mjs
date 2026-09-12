import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const receipt=source.slice(source.indexOf('  function uploadReceipt('),source.indexOf('  function uploadFile('));
const chunks=source.slice(source.indexOf('  function putChunks('),source.indexOf('  // 오류를 사람이'));
async function run(responses,data='abcdef'){
 const calls=[];const context={Blob,Promise,Math,Number,Error,JSON,navigator:{onLine:true},MAX_UPLOAD_RETRY:2,RESUMABLE_CHUNK:3,MOBILE_CHUNK:3,isTouchDevice:()=>false,safeParse:t=>{try{return JSON.parse(t)}catch{return null}},sleep:()=>Promise.resolve(),renewQuietly:()=>Promise.resolve(),putChunk:async(url,body,range)=>{calls.push({range,body:body?await body.text():null});const r=responses.shift();if(!r)throw Error('unexpected request');if(r instanceof Error)throw r;return r;}};
 vm.createContext(context);vm.runInContext(receipt+chunks,context);
 let error=null,result=null;try{result=await context.putChunks('mock-session',new Blob([data]));}catch(e){error=e;}
 return {calls,error,result};
}
const pending=(range='')=>({status:308,range,text:''});const done={status:200,text:'{"id":"saved-id"}'};
let r=await run([{status:500,text:'{"error":{}}'}],'');assert(r.error);console.log('PASS empty-file error is rejected');
r=await run([{status:200,text:'{}'}],'');assert(r.error);console.log('PASS missing file ID is rejected');
r=await run([done],'');assert.equal(r.result.id,'saved-id');console.log('PASS empty-file confirmed completion');
r=await run([pending(),pending(),pending(),pending('bytes=0-2'),done]);assert.equal(r.result.id,'saved-id');assert.equal(r.calls[1].body,'abc');assert.equal(r.calls[3].body,'abc');assert.equal(r.calls[4].body,'def');console.log('PASS no Range resends unconfirmed bytes');
r=await run([pending(),new Error('NET'),pending('bytes=0-1'),pending('bytes=0-4'),done]);assert.equal(r.result.id,'saved-id');assert.equal(r.calls[3].body,'cde');assert.equal(r.calls[4].body,'f');console.log('PASS interrupted upload resumes after confirmed bytes');
r=await run([pending('bytes=0-999')]);assert(r.error);console.log('PASS invalid received range rejected');
r=await run([pending(),{status:200,text:'{}'}]);assert(r.error);console.log('PASS final response without ID rejected');
r=await run([pending(),{status:401},{status:401},{status:401}]);assert(r.error);assert.equal(r.calls.length,4);console.log('PASS repeated auth failures stop');
r=await run([pending(),pending('bytes=0-5'),pending('bytes=0-5'),pending('bytes=0-5'),pending('bytes=0-5')]);assert(r.error);console.log('PASS unconfirmed completion rejects instead of returning success');
