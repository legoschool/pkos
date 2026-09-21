import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const app=resolve(import.meta.dirname,'../..');
const root=join(app,'00_테스트 파일 생성');
if(!existsSync(root))throw Error('사용자가 만든 테스트 폴더가 없습니다');
const suite=join(root,'PKOS_검증_20260920');
if(existsSync(suite))throw Error('기존 테스트 자료를 덮어쓰지 않습니다');
const manifest=[];
function put(name,data,kind='normal'){
 const path=resolve(suite,name);if(!path.startsWith(suite+'\\'))throw Error('범위 밖');
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data,{flag:'wx'});
 manifest.push({name,kind,size:Buffer.byteLength(data),sha256:createHash('sha256').update(data).digest('hex')});
}
const bodies=[
'**굵은 글씨**와 *기울임*, ~~취소선~~, `inline code`',
'## 관찰 기록\n\n### 다음 질문\n\n본문검색_분수실험',
'- 첫 번째 준비물\n- 두 번째 준비물\n  - 안쪽 항목',
'1. 도입 질문\n2. 학생 관찰\n3. 수업 기록',
'- [ ] 준비하기\n- [x] 기록하기',
'> 가상 교사의 인용문입니다.\n> 실제 학생 정보가 아닙니다.',
'| 항목 | 값 |\n| --- | --- |\n| 관찰 | 12 |\n| 질문 | 7 |',
'```javascript\nconst text = "<script>TEST</script>";\n```',
'[Google 도움말](https://support.google.com/drive/)\n\nhttps://example.com/',
'[[01_가상기록]]와 [[없는 기록]] 연결 확인',
'![시험 이미지](../첨부/테스트.png)\n\n[시험 PDF](../첨부/텍스트.pdf)',
'[없는 첨부](../첨부/존재하지않음.pdf)',
'한글 English 日本語 中文 café e\u0301, 괄호 [ ] & < > " 따옴표',
('가상 관찰 기록입니다. 분수와 수업 질문을 연결합니다.\n').repeat(1200)+'\n긴본문끝_검증토큰',
'동일한 제목을 가진 기록도 파일 경로로 구분합니다.',
'줄바꿈\n둘째 줄\n\n새 문단',
'<script>window.__fixtureExecuted=true</script>\n<img src=x onerror="window.__fixtureExecuted=true">',
'---\n\n구분선 다음 문장',
'[이름에 공백이 있는 파일](../첨부/공백%20파일.txt)',
'본문검색_인공지능 AI 수업 설계. 태그와 폴더 연결을 확인합니다.'
];
for(let i=0;i<bodies.length;i++){
 const id=String(i+1).padStart(2,'0'), title=id+'_가상기록';
 put('기록/'+title+'.md',`---\nid: pkos-fixture-${id}\ntitle: "${title}"\ntags: [검증자료, ${i%2?'수업':'연수'}]\n---\n# ${title}\n\n${bodies[i]}\n`);
}
put('다른 폴더/01_가상기록.md','# 01_가상기록\n\n동명이름_구별토큰');
put('경계/빈 기록.md','');
put('첨부/공백 파일.txt','PKOS_PLAIN_BODY 텍스트 검색 검증');
put('첨부/표.csv','이름,점수\n가상A,12\n가상B,9\n');
put('첨부/표.tsv','항목\t수치\n관찰\t17\n');
put('첨부/데이터.json',JSON.stringify({fixture:true,text:'JSON_BODY_TOKEN'}));
put('첨부/문서.xml','<?xml version="1.0" encoding="UTF-8"?><test>XML_BODY_TOKEN</test>');
put('첨부/페이지.html','<!doctype html><meta charset="utf-8"><h1>가상 HTML</h1><p>HTML_BODY_TOKEN</p>');
put('첨부/링크.url','[InternetShortcut]\r\nURL=https://example.com/\r\n');
put('첨부/벡터.svg','<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#dce8f0"/><text x="20" y="80">PKOS TEST</text></svg>');
put('첨부/테스트.png',readFileSync(join(app,'icons/icon-192.png')));
for(const [src,name] of [['pdf-sample.pdf','텍스트.pdf'],['pdf-multipage.pdf','여러쪽.pdf']])put('첨부/'+name,readFileSync(join(app,'docs/점검도구',src)));
const wave=Buffer.alloc(44+16000);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(16000,40);for(let i=0;i<8000;i++)wave.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/8000)*1500),44+i*2);put('첨부/시험음.wav',wave);
const docs=JSON.parse(readFileSync(join(app,'docs/점검도구/문서-fixtures.json'),'utf8'));
for(const name of ['sample.docx','sample.xlsx','sample.pptx','sample.hwpx','sample.zip','long.docx','long.xlsx','long.hwpx','long.pptx','broken.docx','unsafe.docx'])if(docs[name])put('문서구조검증/'+name,Buffer.from(docs[name],'base64'),name.startsWith('sample')||name.startsWith('long')?'parser-fixture':'invalid-expected');
const odf=JSON.parse(readFileSync(join(app,'docs/점검도구/odf-fixtures.json'),'utf8'));
for(const [name,data]of Object.entries(odf))if(typeof data==='string')put('문서구조검증/'+name,Buffer.from(data,'base64'),'parser-fixture');
put('경계/손상.pdf',Buffer.from('%PDF-1.4\nbroken'),'invalid-expected');
put('경계/알수없는형식.pkostest',Buffer.from([0,1,2,3,255]),'unsupported-expected');
put('경계/빈 텍스트.txt','');
writeFileSync(join(root,'테스트자료_목록.json'),JSON.stringify({suite,notice:'모두 가상 자료. 문서구조검증 폴더는 파서 회귀검사용 축약 fixture이며 Office 완제품 문서가 아닙니다.',files:manifest},null,2));
console.log(JSON.stringify({suite,count:manifest.length,extensions:[...new Set(manifest.map(x=>x.name.split('.').pop()))]},null,2));
