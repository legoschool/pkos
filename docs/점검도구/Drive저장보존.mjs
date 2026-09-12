import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const logic=source.slice(source.indexOf('  function readDriveSyncIssue('),source.indexOf('  function connect('));
let failUpload=true,failIndex=false,indexWrites=0,deleted=[];
const attachment={id:'attachment',kind:'file',name:'bytes.bin',blob:new Blob(['KEEP-BYTES'])};
const entry={id:'entry',title:'기록',mdId:'existing-md',blocks:[attachment]};
const stored=new Map();const localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
const c={localStorage,encodeURIComponent,Blob,Promise,Date,console:{warn(){}},entries:[entry],localOn:false,connected:true,folder:{id:'folder'},indexIncomplete:false,settings:{alsoGdoc:false,alsoHtml:false},localIsId:id=>String(id||'').startsWith('local:'),resolveTargets:async()=>({file:'files',md:'notes'}),progress(){},setSyncPill(text){c.pill=text},toast(){},toast2(){},errText:e=>e.message,uploadAttachment:async()=>{if(failUpload)throw Error('network');return {id:'uploaded-id'};},dropPreview(){},idbDel:id=>deleted.push(id),mdName:()=> 'note.md',uniqueName:async x=>x,uploadFile:async()=>({id:'existing-md'}),buildMarkdown:()=>'',syncTagShortcuts:async()=>{},saveIndex:async()=>{indexWrites++;if(failIndex)throw Error('index failure');},saveLocal(){},render(){}};
vm.createContext(c);vm.runInContext(logic,c);
assert.equal(await c.syncPending(),false);assert.equal(await attachment.blob.text(),'KEEP-BYTES');assert.equal(deleted.length,0);assert.equal(c.driveSyncIssue,'업로드 대기 1개');console.log('PASS failed upload preserves blob and does not remove stored attachment');
failUpload=false;assert.equal(await c.syncPending(),true);assert.equal(attachment.fileId,'uploaded-id');assert.equal(attachment.blob,undefined);assert.deepEqual(deleted,['attachment']);assert.equal(c.driveSyncIssue,'');console.log('PASS successful retry updates ID and releases pending blob');
entry._dirty=true;failIndex=true;assert.equal(await c.syncPending(),false);assert.equal(c.driveSyncIssue,'동기화 저장 실패');const before=indexWrites;failIndex=false;assert.equal(await c.syncPending(),true);assert.equal(indexWrites,before+1);assert.equal(c.driveSyncIssue,'');console.log('PASS index failure retries even when no record remains dirty');
c.indexIncomplete=true;entry._dirty=true;assert.equal(await c.syncPending(),false);assert.equal(c.driveSyncIssue,'동기화 저장 실패');console.log('PASS incomplete index cannot report success');

// Simulate a new execution after metadata was saved but index upload failed.
c.indexIncomplete=false;entry._dirty=true;failIndex=true;await c.syncPending();assert(stored.get('pkos.drive-sync.pending.folder'));
const restarted={...c,entries:[{id:'entry',title:'기록',mdId:'existing-md',blocks:[]}],saveIndex:async()=>{indexWrites++;}};
vm.createContext(restarted);vm.runInContext(logic,restarted);const count=indexWrites;assert.equal(await restarted.syncPending(),true);assert.equal(indexWrites,count+1);assert.equal(stored.get('pkos.drive-sync.pending.folder'),undefined);console.log('PASS restart retries failed index with clean records');
stored.set('pkos.drive-sync.pending.folder','동기화 저장 실패');const other={...c,folder:{id:'other-folder'},entries:[]};vm.createContext(other);vm.runInContext(logic,other);assert.equal(other.driveSyncIssue,'');assert.equal(await other.syncPending(),true);assert(stored.get('pkos.drive-sync.pending.folder'));console.log('PASS another folder cannot clear original pending state');
