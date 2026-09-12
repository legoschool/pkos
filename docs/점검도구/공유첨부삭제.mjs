import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const code=section('  function referencedByOtherRecord(', '  async function localMoveEntryFiles(')+section('  function trashFile(', '  // 같은 폴더에 같은 이름')+section('  function purgeNow(', '  /* =========================================================\n     10.');
function setup(entries){const calls=[];const c={entries,connected:true,localOn:false,editingId:null,localIsId:id=>String(id).startsWith('local:'),driveFetch:(url,opts)=>{calls.push({url,opts});return Promise.resolve({ok:true});},localPurgeEntry:()=>{},idbDel:()=>{},addTomb:()=>{},resetComposer:()=>{},calls};vm.createContext(c);vm.runInContext(code,c);return c;}
const a={id:'a',folderId:'folder-a',mdId:'md-a',blocks:[{fileId:'shared'},{fileId:'own'},{fileId:'own'}]},b={id:'b',blocks:[{fileId:'shared'}]};
let c=setup([a,b]);vm.runInContext("purgeNow('a')",c);
assert.deepEqual(c.calls.map(x=>x.url.split('/files/')[1].split('?')[0]).sort(),['md-a','own']);assert.equal(c.entries.length,1);assert.equal(c.entries[0].blocks[0].fileId,'shared');console.log('PASS shared file and containing folder preserved; own files deleted once');
c=setup([{...a}, {...b,trashed:true}]);vm.runInContext("purgeNow('a')",c);assert(!c.calls.some(x=>x.url.includes('/shared?')));console.log('PASS references from trash retained');
c=setup([{...a,srcId:'imported-original'}]);vm.runInContext("purgeNow('a')",c);assert.equal(c.calls.length,0);console.log('PASS imported original preserved');
c=setup([]);await vm.runInContext("trashFile('local:private/path.txt')",c);assert.equal(c.calls.length,0);console.log('PASS local file path never sent to Drive');
