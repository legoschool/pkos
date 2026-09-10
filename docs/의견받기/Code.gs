/**
 * 개인지식운영체제 · PKOS — 의견 받는 자리
 *
 * 앱 오른쪽 아래 💬 로 들어온 질문·개선 의견·오류를 이 시트에 한 줄씩 쌓는다.
 * 서버를 두지 않는 앱이라, 받는 자리는 이 웹 앱 하나다.
 *
 * 붙이는 법
 *   1. 의견을 모을 구글 시트를 연다
 *   2. [확장 프로그램] → [Apps Script]
 *   3. 이 파일 내용을 그대로 붙여 넣고 저장
 *   4. [배포] → [새 배포] → 유형 «웹 앱»
 *        실행 계정   · 나
 *        액세스 권한 · 모든 사용자      ← 이걸 안 바꾸면 로그인한 사람만 보낼 수 있다
 *   5. 나온 /exec 주소를 앱의 [설정] → [💬 의견 받기] 에 붙여 넣는다
 *
 * ⚠️ 코드를 고친 뒤에는 «새 배포» 를 다시 해야 바뀐 것이 적용된다.
 *    (같은 주소를 쓰려면 [배포 관리] → 연필 → 버전 «새 버전» → 배포)
 */

/** 시트 이름. 없으면 만든다. */
var SHEET_NAME = '의견';

/** 열 차례. 이 순서가 곧 시트의 머리줄이다. */
var HEADERS = [
  '접수시각', '종류', '내용', '답 받을 곳',
  '지금 화면', '창 크기', '드라이브', '기록 수',
  '쪽', '브라우저', '언어', '앱 갱신일',
  '보낸 기기', '접수번호', '상태', '처리 메모'
];

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var d = JSON.parse(raw);

    // 사람이 적은 글이 없으면 받지 않는다 · 빈 줄이 쌓이면 시트를 못 읽는다
    var text = String(d.text || '').trim();
    if (!text) return reply({ ok: false, error: 'empty' });
    if (text.length > 4000) text = text.slice(0, 4000) + ' …(잘림)';

    var sh = getSheet_();
    sh.appendRow([
      new Date(),
      String(d.kind || '').slice(0, 20),
      text,
      String(d.contact || '').slice(0, 200),
      String(d.where || '').slice(0, 200),
      String(d.screen || '').slice(0, 40),
      String(d.connected || '').slice(0, 20),
      Number(d.entries || 0),
      String(d.page || '').slice(0, 60),
      String(d.ua || '').slice(0, 400),
      String(d.lang || '').slice(0, 20),
      String(d.built || '').slice(0, 60),
      String(d.clientId || '').slice(0, 40),
      String(d.id || '').slice(0, 40),
      '새로 들어옴',
      ''
    ]);
    return reply({ ok: true });
  } catch (err) {
    // 실패해도 사람에게는 조용히 · 대신 실행 로그에 남긴다
    console.error(err);
    return reply({ ok: false, error: String(err) });
  }
}

/** 브라우저가 주소를 그냥 열어 봤을 때 · 살아 있는지만 알려 준다 */
function doGet() {
  return reply({ ok: true, note: '개인지식운영체제 · PKOS 의견 받는 자리입니다.' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  // 머리줄이 없으면 세운다 · 처음 한 번만 걸린다
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);   // 접수시각
    sh.setColumnWidth(3, 420);   // 내용
    sh.getRange(1, 3, sh.getMaxRows(), 1).setWrap(true);
  }
  return sh;
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
