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

/** 캡처를 담아 둘 폴더 이름. 시트가 든 폴더 안에 만든다. */
var SHOT_FOLDER = '의견 캡처';

/** 받아 줄 캡처의 최대 크기 (내려받은 실제 바이트 기준) */
var MAX_SHOT_BYTES = 6 * 1024 * 1024;

/** 열 차례. 이 순서가 곧 시트의 머리줄이다. */
var HEADERS = [
  '접수시각', '종류', '내용', '캡처', '답 받을 곳',
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

    /* 캡처가 왔으면 먼저 드라이브에 담는다.
       ⚠️ 이 스크립트는 «시트 주인» 의 계정으로 돈다. 그래서 보내는 사람이 드라이브에
          로그인해 있지 않아도, 아무 권한이 없어도 그림이 주인 드라이브에 들어간다.
       ⚠️ 공유 설정은 건드리지 않는다 · 캡처에는 보낸 사람의 화면이 찍혀 있다.
          주인만 열 수 있게 두는 것이 맞다. */
    var shotUrl = '';
    if (d.shot) {
      try { shotUrl = saveShot_(d.shot, d.shotName, d.id); }
      catch (err2) { console.error(err2); shotUrl = '(캡처 저장 실패: ' + err2 + ')'; }
    }

    var sh = getSheet_();
    sh.appendRow([
      new Date(),
      String(d.kind || '').slice(0, 20),
      text,
      shotUrl,
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
    /* 캡처를 어디에 담았는지 돌려준다.
       ⚠️ 보낸 쪽은 이 답을 보고 «그림까지 갔는지» 를 안다. 안 돌려주면 옛 판 스크립트와
          구별이 안 되어, 그림을 버렸는데도 「보냈습니다」 라고 말하게 된다. */
    return reply({ ok: true, shot: shotUrl, shotOk: !!d.shot });
  } catch (err) {
    // 실패해도 사람에게는 조용히 · 대신 실행 로그에 남긴다
    console.error(err);
    return reply({ ok: false, error: String(err) });
  }
}

/**
 * 캡처 한 장을 드라이브에 담고 주소를 돌려준다.
 * 받는 꼴은 data URL (data:image/png;base64,…) 이다.
 * 시트가 든 폴더 «옆» 에 「의견 캡처」 폴더를 두어, 시트와 그림이 같이 다니게 한다.
 */
function saveShot_(dataUrl, name, id) {
  var m = /^data:([\w.+-]+\/[\w.+-]+);base64,([\s\S]+)$/.exec(String(dataUrl));
  if (!m) throw new Error('그림 꼴이 아닙니다');
  var mime = m[1];
  if (mime.indexOf('image/') !== 0) throw new Error('그림만 받습니다');

  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_SHOT_BYTES) throw new Error('너무 큽니다 (' + Math.round(bytes.length / 1024) + 'KB)');

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var ext = mime.split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  var safe = String(name || '').replace(/[\/:*?"<>|]/g, '').slice(0, 40);
  var fileName = stamp + '_' + (id || 'shot') + (safe ? '_' + safe : '') + '.' + ext;

  var blob = Utilities.newBlob(bytes, mime, fileName);
  var file = shotFolder_().createFile(blob);
  return file.getUrl();
}

/** 「의견 캡처」 폴더 · 시트가 든 폴더 안에 둔다. 없으면 만든다. */
function shotFolder_() {
  var ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var parents = ssFile.getParents();
  var home = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var found = home.getFoldersByName(SHOT_FOLDER);
  return found.hasNext() ? found.next() : home.createFolder(SHOT_FOLDER);
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
  // 머리줄이 없으면 세운다 · 처음 한 통이 들어올 때 저절로 걸린다
  if (sh.getLastRow() === 0) dressHeader_(sh);
  return sh;
}

/**
 * 머리줄을 세우고 보기 좋게 다듬는다.
 * 첫 의견이 들어올 때 저절로 불리므로, 보통은 사람이 부를 일이 없다.
 * 시트를 새로 만들었거나 머리줄을 지웠을 때만 손으로 부른다.
 */
function dressHeader_(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);   // 접수시각
  sh.setColumnWidth(2, 90);    // 종류
  sh.setColumnWidth(3, 420);   // 내용
  sh.setColumnWidth(4, 210);   // 캡처
  sh.setColumnWidth(5, 160);   // 답 받을 곳
  sh.setColumnWidth(6, 180);   // 지금 화면
  sh.getRange(1, 3, sh.getMaxRows(), 1).setWrap(true);
  sh.getRange(1, 1, 1, HEADERS.length).setBackground('#e8f2ee');
}

/**
 * 시트 메뉴 → 「의견 받기」 → 「머리줄 세우기」.
 * 머리줄을 잘못 지웠거나 시트를 새로 팠을 때 이걸 한 번 누르면 된다.
 * ⚠️ 1행만 다시 쓴다 · 아래에 쌓인 의견은 건드리지 않는다.
 */
function 머리줄세우기() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  dressHeader_(sh);
  SpreadsheetApp.getActive().toast('머리줄을 세웠습니다. 쌓인 의견은 그대로입니다.', '의견 받기', 5);
}

/** 시트를 열면 메뉴 하나가 붙는다 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('의견 받기')
    .addItem('머리줄 세우기', '머리줄세우기')
    .addToUi();
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
