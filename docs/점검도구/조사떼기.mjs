/* 기록 사이를 «공통 단어» 로 잇는 셈에서 조사·어미를 떼는지 브라우저 없이 본다.
   index.html 의 knowledgeAnalysis 와 stemKo 를 잘라 내 그대로 돌린다. 형태소 분석이 아니라 꼬리 자르기라는 한계도 여기서 못 박는다.
   실행:  node docs/점검도구/조사떼기.mjs */
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const logic = source.slice(source.indexOf('  function knowledgeAnalysis('), source.indexOf('  function isInbox('));
const c = { Map, Set, JSON, Array, Number, String, Math, RegExp };
vm.createContext(c); vm.runInContext(logic, c);
let pass = 0;
function ok(name, cond) { assert(cond, name); pass++; console.log('  OK   ' + name); }

// 1. 꼬리 자르기 자체
ok('을·이·에서 를 뗀다', ['블록코딩을', '블록코딩이', '블록코딩에서'].every(w => c.stemKo(w) === '블록코딩'));
ok('들이·으로는 같은 긴 꼬리도 뗀다', c.stemKo('학생들이') === '학생' && c.stemKo('교실으로는') === '교실');
ok('두 글자가 안 남으면 안 뗀다 (회의·사이·정의)', c.stemKo('회의') === '회의' && c.stemKo('사이') === '사이' && c.stemKo('정의') === '정의');
ok('영문은 손대지 않는다', c.stemKo('python') === 'python' && c.stemKo('ai') === 'ai');
ok('꼬리가 없으면 그대로', c.stemKo('블록코딩') === '블록코딩');

// 2. 분석에 반영되는지 · 같은 낱말이 조사만 다르게 나오는 두 기록이 이어진다
const pool = [
  { id: 'a', title: '블록코딩을 배운 날', blocks: [{ text: '학생들이 블록코딩에서 조건문을 처음 만졌다' }] },
  { id: 'b', title: '블록코딩이 재미있는 까닭', blocks: [{ text: '학생을 움직이게 한 것은 조건문이 아니라 소리였다' }] },
  { id: 'c', title: '급식 회의', blocks: [{ text: '회의가 길었다 회의를 줄이자' }] },
];
const r = c.knowledgeAnalysis(pool);
const edge = r.edges.find(e => (e.a === 'a' && e.b === 'b') || (e.a === 'b' && e.b === 'a'));
ok('조사만 다른 두 기록이 공통 단어로 이어진다', !!edge);
ok('공통 단어가 어간으로 잡힌다 (블록코딩·학생·조건문)', ['블록코딩', '학생', '조건문'].every(w => edge.words.includes(w)));
ok('단어 목록에 조사 붙은 꼴이 없다', !r.words.some(([w]) => /(을|를|이|가|에서|들이)$/.test(w) && w.length > 2 && ['블록코딩', '학생', '조건문'].some(s => w.startsWith(s))));
ok('「회의」 는 「회」 로 줄지 않는다', r.words.some(([w]) => w === '회의') && !r.words.some(([w]) => w === '회'));
const cEdge = r.edges.find(e => e.a === 'c' || e.b === 'c');
ok('관계없는 기록은 이어지지 않는다', !cEdge);
console.log('PASS ' + pass + '/' + pass);
