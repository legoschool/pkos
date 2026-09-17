/* 드라이브 방식(웹 앱)에서 «열어 둔 채로도 따라오는지» 를 브라우저 없이 본다.
   index.html 에서 함수 넷(loadIndex · uploadFile · autoSync · 색인 수정 시각 묻기)을 잘라 내
   가짜 드라이브 위에서 돌린다. 진짜 구글 왕복은 여기서 재지 않는다 · 그건 사람이 두 기기로 잰다.
   실행:  node docs/점검도구/드라이브따라오기.mjs */
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function slice(from, to) {
  const a = source.indexOf(from); assert(a >= 0, '못 찾음: ' + from);
  const b = source.indexOf(to, a); assert(b > a, '끝을 못 찾음: ' + to);
  return source.slice(a, b);
}
const logic = [
  slice('  function uploadFile(', '  /* ---- 화면이 꺼지지 않게'),
  slice('  function loadIndex() {', '  function addTomb('),
  slice('  function autoSync(force) {', '  document.addEventListener("visibilitychange", function () { if (!document.hidden) autoSync(); });'),
  slice('  /* ---- 열어 둔 채로도 따라온다', '  setInterval(pollIndexStamp, INDEX_POLL_MS);'),
].join('\n');

// ---- 가짜 드라이브 ----
let remoteStamp = '1@2026-09-17T00:00:00.000Z';   // 드라이브에 있는 색인의 판·수정 시각
let metaFails = false;
const calls = [];                                 // 무엇을 어떤 순서로 불렀나
const c = {
  Promise, Date, String, JSON, Math, Error, console: { warn() {} },
  document: { hidden: false }, navigator: { onLine: true },
  setInterval() { return 1; },                     // 15초 시계는 걸지 않고 pollIndexStamp 를 손으로 부른다
  connected: true, localOn: false, syncing: false, lastSyncAt: 0,
  indexFileId: 'idx', indexIncomplete: false, sharded: false, shardCount: 1, shardIds: {}, shardSig: {},
  folder: { id: 'folder' }, INDEX_NAME: 'PKOS-index.json', accessToken: 'token',
  uploadReceipt: (v) => v,
  driveJson(url) {
    if (url.indexOf('fields=modifiedTime,version') >= 0) {
      calls.push('meta');
      if (metaFails) return Promise.reject(new Error('meta down'));
      return Promise.resolve({ version: remoteStamp.split('@')[0], modifiedTime: remoteStamp.split('@')[1] });
    }
    if (url.indexOf('/upload/') >= 0) { calls.push('upload'); remoteStamp = (Number(remoteStamp.split('@')[0]) + 1) + '@2026-09-17T00:00:09.000Z'; return Promise.resolve({ id: 'idx', name: 'PKOS-index.json' }); }
    throw new Error('뜻밖의 호출 ' + url);
  },
  findIndexFile: () => Promise.resolve('idx'),
  readMedia() { calls.push('media'); return Promise.resolve({ entries: [{ id: 'r1', updatedAt: 1 }], deleted: [] }); },
  readStrayShards: (x) => Promise.resolve(x), migrate: (x) => x, loadSharded: (j) => Promise.resolve(j),
  toast() {}, setSyncPill() {}, absorbIndex() {}, saveLocal() {}, render() {},
  syncPending: () => Promise.resolve(true),
};
vm.createContext(c); vm.runInContext(logic, c);
const downloads = () => calls.filter((x) => x === 'media').length;
const metas = () => calls.filter((x) => x === 'meta').length;
let pass = 0;
function ok(name, cond) { assert(cond, name); pass++; console.log('  OK   ' + name); }

// 1. 처음 연결: 색인을 읽을 때 «수정 시각 → 내용» 순서로 읽고 도장을 찍는다
await c.loadIndex();
ok('loadIndex asks stamp before media', calls.join(',') === 'meta,media');
ok('stamp recorded after first load', c.indexStamp === remoteStamp);

// 2. 아무것도 안 바뀌면 묻기만 하고 내려받지 않는다
calls.length = 0; ok('unchanged poll returns false', (await c.pollIndexStamp()) === false);
ok('unchanged poll: one meta, no media', metas() === 1 && downloads() === 0);

// 3. 다른 기기가 색인을 올렸다 → 내려받는다 (autoSync 의 20초 간격도 뛰어넘는다)
c.lastSyncAt = Date.now(); remoteStamp = '2@2026-09-17T00:00:05.000Z'; calls.length = 0;
ok('changed poll returns true', (await c.pollIndexStamp()) === true);
ok('changed poll downloads once (poll meta + reload meta)', downloads() === 1 && metas() === 2);
ok('changed poll refreshes stamp', c.indexStamp === remoteStamp);
ok('polling flag released', c.indexPolling === false);

// 4. 화면이 안 보이면 묻지도 않는다
c.document.hidden = true; calls.length = 0; await c.pollIndexStamp(); ok('hidden tab: no request', calls.length === 0); c.document.hidden = false;
// 5. 내 컴퓨터 폴더 방식은 여기 오지 않는다
c.localOn = true; calls.length = 0; await c.pollIndexStamp(); ok('local folder mode: no request', calls.length === 0); c.localOn = false;
// 6. 이미 동기화 중이면 겹치지 않는다
c.syncing = true; calls.length = 0; await c.pollIndexStamp(); ok('while syncing: no request', calls.length === 0); c.syncing = false;
// 7. 오프라인이면 묻지 않는다
c.navigator.onLine = false; calls.length = 0; await c.pollIndexStamp(); ok('offline: no request', calls.length === 0); c.navigator.onLine = true;

// 8. 내가 올린 색인은 «남이 바꾼 것» 으로 다시 내려받지 않는다
calls.length = 0; await c.uploadFile('PKOS-index.json', 'application/json', '{}', false, 'idx', 'folder');
await new Promise((r) => setTimeout(r, 0));
ok('own upload refreshes stamp right away', calls.join(',') === 'upload,meta' && c.indexStamp === remoteStamp);
calls.length = 0; ok('poll after own upload does not download', (await c.pollIndexStamp()) === false && downloads() === 0);

// 9. 물어보기가 실패해도 조용히 넘어가고 다음 물음이 막히지 않는다
metaFails = true; calls.length = 0; ok('meta failure returns false', (await c.pollIndexStamp()) === false);
ok('meta failure releases polling flag', c.indexPolling === false);
metaFails = false; remoteStamp = '3@2026-09-17T00:00:20.000Z'; calls.length = 0;
ok('next change after failure still downloads', (await c.pollIndexStamp()) === true && downloads() === 1);

// 10. 같은 물음이 겹쳐 들어와도 한 번만 묻는다
remoteStamp = '4@2026-09-17T00:00:30.000Z'; calls.length = 0;
const [a, b] = await Promise.all([c.pollIndexStamp(), c.pollIndexStamp()]);
// 물음 하나 + 내려받을 때 loadIndex 가 다시 찍는 도장 하나 = meta 둘. 겹친 둘째 물음은 아무것도 부르지 않는다
ok('overlapping ticks: one poll, one download', metas() === 2 && downloads() === 1 && (a || b) && !(a && b));

console.log('PASS ' + pass + '/' + pass);
