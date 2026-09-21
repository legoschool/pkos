import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf('  function '+name+'(')>=0?source.indexOf('  function '+name+'('):source.indexOf('  async function '+name+'(');
  assert(start>=0,name);
  const end=source.indexOf('\n  }',start);
  assert(end>start,name+' end');
  return source.slice(start,end+4);
}
class Element {
  constructor(text=''){this.textContent=text;this.value='';this.children=[];this.classList={add(){},remove(){}};}
  appendChild(e){this.children.push(e);return e;}
  replaceChildren(){this.children=[];}
}
const store=new Map(),els=new Map();
const c={console,Promise,Date,JSON,Error,encodeURIComponent,Array,Map,Set,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 LS:{draft:'draft',email:'email',folder:'folder'},safeParse:s=>s?JSON.parse(s):null,
 $:id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);},el:(tag,cls,text)=>new Element(text),
 pendingStoredDraft:false,entries:[],folder:{id:'root',name:'Current folder'},
 connected:true,localOn:false,localPending:false,localName:'',userEmail:'fixture@example.invalid',
 driveDirectories:null,driveProbeTask:Promise.resolve(),PROBE_MAX:40,
 localIsId:id=>String(id).startsWith('local:'),render(){},draftHasContent:()=>false,
 toast(){},restoreDraft(){throw Error('must not automatically restore');},
};
vm.createContext(c);
for(const name of ['draftScope','preserveStoredDraft','offerStoredDraft','liveEntries','currentViewEntries','samePath','anchorIdOf','probeFile','probeStrays','relearnPlaces'])vm.runInContext(fn(name),c);
let passes=0;
function ok(name,condition){assert(condition,name);passes++;console.log('PASS '+name);}
const draft={editingId:'gone',title:'Old draft',blocks:[{id:'attachment',kind:'image',name:'kept.png'}]};
store.set('draft',JSON.stringify(draft));
c.offerStoredDraft();
ok('old draft is offered, not inserted into editor',c.pendingStoredDraft&&c.$('title').value==='');
ok('offered draft remains intact',store.get('draft')===JSON.stringify(draft));
c.preserveStoredDraft();
ok('starting another note archives old draft and attachment references',JSON.parse(store.get('pkos.draft-history.v1'))[0].blocks[0].id==='attachment');
c.preserveStoredDraft();
ok('draft archive is idempotent',JSON.parse(store.get('pkos.draft-history.v1')).length===1);
c.entries=[{id:'ok'},{id:'missing',_missing:true},{id:'away',_away:true},{id:'local',localMissing:true},{id:'trash',trashed:true}];
ok('normal counts exclude unavailable records',c.liveEntries().map(n=>n.id).join()==='ok');
c.smartView='unavailable';
ok('unavailable copies remain recoverable',c.currentViewEntries().length===3);
c.driveFetch=async()=>({status:404,ok:false});
const missing={id:'m',mdId:'m'};await c.probeStrays([missing]);
ok('404 is marked unavailable',missing._missing===true);
for(const status of [403,500]){
 c.driveFetch=async()=>({status,ok:false});const n={id:'n',mdId:'n'};await c.probeStrays([n]);
 ok(status+' is not treated as deletion',!n._missing&&n._locationUnchecked);
}
c.driveFetch=async()=>({status:200,ok:true,json:async()=>({id:'alive',name:'Alive'})});
const alive={mdId:'alive',_missing:true,_away:true};await c.probeStrays([alive]);
ok('accessible file omitted by folder permissions is not declared outside root',!alive._missing&&!alive._away&&alive._locationUnchecked);
const many=Array.from({length:42},(_,i)=>({mdId:String(i)}));await c.probeStrays(many);
ok('probe limit never marks unqueried records missing',!many[41]._missing&&many[41]._locationUnchecked);
c.entries=[{id:'move',mdId:'move',srcPath:['Old'],_missing:true}];
c.relearnPlaces({files:[{id:'move',_parent:'new',_parentName:'New',_path:['New']}],dirs:[{id:'new',path:['New']}],truncated:false});
ok('actual file path replaces stale indexed path',c.entries[0].srcPath[0]==='New'&&!c.entries[0]._missing&&c.entries[0]._driveRoot==='root');
c.entries=[{id:'unseen',mdId:'unseen'}];c.relearnPlaces({files:[],truncated:true});await c.driveProbeTask;
ok('partial scan does not infer deletion',!c.entries[0]._missing);
ok('missing edited record is never silently cleared',!source.includes('if (!n) { resetComposer(); return; }'));
ok('previous desk is not automatically activated',source.includes('var desk = null;'));
ok('boot only offers previous draft',source.includes('offerStoredDraft();   // 이전 초안'));
console.log('PASS '+passes+' regression checks');

Object.assign(c,{workspaceAccount:'fixture@example.invalid',tombstones:[],desk:null,deskList:[],
 migrate:x=>x,closeViewer(){},resetComposer(){},saveDraft(){},filterPath:[],selectedFolders:[],filterTags:[],filterIds:null,searchQ:'',smartView:''});
vm.runInContext(fn('activateDriveFolder'),c);
c.entries=[{id:'old-folder-record',title:'keep'}];c.tombstones=[{id:'old-tomb',at:1}];
c.activateDriveFolder({id:'other-root',name:'Other'});
ok('changing connected root does not mix old files or deletion markers',c.entries.length===0&&c.tombstones.length===0);
c.entries=[{id:'other-folder-record'}];c.activateDriveFolder({id:'root',name:'Current'});
ok('reconnecting previous root restores its preserved cache',c.entries[0].id==='old-folder-record'&&c.tombstones[0].id==='old-tomb');

Object.assign(c,{editingId:null,entries:[],tombstones:[],JUNK_RE:/^\./,isAppFile:n=>n.startsWith('PKOS-'),isImportable:()=>true,
 parseFrontMatter:text=>({fm:{},body:text}),unquote:s=>s||'',stemOf:s=>s.replace(/\.md$/,''),parseListValue:()=>[],
 bodyToBlocks:text=>[{kind:'text',text}],entryFromFile:f=>({id:'temp',title:f.name,srcId:f.id,blocks:[{kind:'file',fileId:f.id}],createdAt:1}),
 driveFetch:async()=>({ok:true,text:async()=>'# First\nContent'})});
vm.runInContext(fn('refreshDriveMirror'),c);
const f={id:'new',name:'new.md',modifiedTime:'2026-09-21T00:00:00Z',_parent:'sub',_path:['Real']};
await c.refreshDriveMirror({files:[f]},'root');
ok('new Drive file is discovered without an index entry',c.entries.length===1&&c.entries[0].mdId==='new'&&c.entries[0].driveMirror);
c.driveFetch=async()=>({ok:true,text:async()=>'# Changed\nNew content'});
await c.refreshDriveMirror({files:[{...f,modifiedTime:'2026-09-21T01:00:00Z',_path:['Moved']}]},'root');
ok('external Markdown changes and moves update the same record',c.entries.length===1&&c.entries[0].title==='Changed'&&c.entries[0].srcPath[0]==='Moved');
c.entries[0]._dirty=true;
await c.refreshDriveMirror({files:[{...f,modifiedTime:'2026-09-21T02:00:00Z'}]},'root');
ok('pending user edits are not overwritten by external changes',c.entries[0].title==='Changed');
console.log('PASS total '+passes+' regression checks');
