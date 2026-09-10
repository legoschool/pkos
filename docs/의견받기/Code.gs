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
 *   4. [배포] → [배포 관리] → 연필 → 버전 «새 버전» → [배포]
 *        ⚠️ [새 배포] 를 누르면 주소가 «바뀐다». 같은 주소를 지키려면 [배포 관리] 다.
 *        실행 계정   · 나
 *        액세스 권한 · 모든 사용자      ← 이걸 안 바꾸면 로그인한 사람만 보낼 수 있다
 *   5. /exec 주소를 브라우저로 열어 보면 지금 깔린 판이 보인다 ({"ok":true,"ver":5,…})
 *
 * ⚠️ 코드를 고치고 «저장» 만 하면 웹 앱에는 반영되지 않는다. 반드시 4번을 다시 한다.
 */

/** 이 파일의 판 번호. 배포가 먹혔는지 주소 한 번 열어서 확인할 때 쓴다. */
var VER = 5;

/** 시트 이름. 없으면 만든다. */
var SHEET_NAME = '의견';

/** 캡처를 담아 둘 폴더 이름. 시트가 든 폴더 안에 만든다. */
var SHOT_FOLDER = '의견 캡처';

/** 받아 줄 캡처의 최대 크기 (내려받은 실제 바이트 기준) */
var MAX_SHOT_BYTES = 6 * 1024 * 1024;

/**
 * 열 차례. 이 순서가 곧 시트의 머리줄이다.
 *
 * ⚠️ 한때 열일곱 칸이었다. 언어·기록 수·쪽·브라우저 원문·보낸 기기·앱 갱신일을
 *    저마다 한 칸씩 차지하게 두었더니, 정작 읽어야 할 「내용」 이 화면 밖으로 밀렸다.
 *    표는 «읽으라고» 만드는 것이다.
 *    앞 일곱 칸이 읽고 처리하는 칸, 뒤 두 칸이 고칠 자리를 좁히는 칸이다.
 *    버린 것이 아니라 「자세히」 한 칸에 접어 넣었다 · 필요할 때 칸을 넓혀 보면 된다.
 */
var HEADERS = [
  '접수시각', '종류', '내용', '캡처', '답 받을 곳', '상태', '처리 메모',
  '어디서', '자세히'
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
    var shotOk = false;
    if (d.shot) {
      try { shotUrl = saveShot_(d.shot, d.shotName, d.id); shotOk = true; }
      catch (err2) {
        console.error(err2);
        /* ⚠️ 예외 원문을 그대로 칸에 넣으면 한 칸에 300자가 들어가 표를 밀어낸다.
           그리고 「무엇을 해야 하는지」 가 안 적혀 있다 · 사람이 읽을 말로 바꾼다. */
        shotUrl = shotError_(err2);
      }
    }

    var sh = getSheet_();
    sh.appendRow([
      new Date(),
      String(d.kind || '').slice(0, 20),
      text,
      shotUrl,
      String(d.contact || '').slice(0, 200),
      '새로 들어옴',
      '',
      String(d.where || '').slice(0, 200),
      detail_(d)
    ]);
    /* 캡처를 어디에 담았는지 돌려준다.
       ⚠️ 보낸 쪽은 이 답을 보고 «그림까지 갔는지» 를 안다. 안 돌려주면 옛 판 스크립트와
          구별이 안 되어, 그림을 버렸는데도 「보냈습니다」 라고 말하게 된다. */
    /* ⚠️ shotOk 는 «그림이 왔나» 가 아니라 «담는 데 성공했나» 다.
       왔다는 것만으로 참을 주면, 권한이 없어 못 담았을 때도 「캡처까지 갔다」 고 말하게 된다. */
    return reply({ ok: true, ver: VER, shot: shotUrl, shotOk: shotOk });
  } catch (err) {
    // 실패해도 사람에게는 조용히 · 대신 실행 로그에 남긴다
    console.error(err);
    return reply({ ok: false, error: String(err) });
  }
}

/**
 * 캡처를 못 담았을 때 시트에 적을 말.
 * 예외 원문 대신 «무엇을 해야 하는지» 를 적는다.
 */
function shotError_(err) {
  var t = String(err || '');
  if (/권한|permission|Authorization|drive/i.test(t)) {
    return '⚠️ 캡처 못 담음 · 드라이브 권한 없음 (스크립트 편집기에서 메뉴 「의견 받기 → 권한 주기」 를 한 번 실행하세요)';
  }
  if (/너무 큽니다|too large/i.test(t)) return '⚠️ 캡처 못 담음 · 그림이 너무 큽니다';
  if (/그림/.test(t)) return '⚠️ 캡처 못 담음 · 그림 꼴이 아닙니다';
  return '⚠️ 캡처 못 담음 · ' + t.slice(0, 90);
}

/**
 * 「자세히」 한 칸 · 고칠 자리를 좁히는 데 쓰는 것들을 한 줄로 접는다.
 * 평소에는 칸이 좁아 안 보이고, 필요할 때 넓혀서 읽으면 된다.
 */
function detail_(d) {
  var bits = [];
  if (d.screen) bits.push('창 ' + d.screen);
  bits.push(browser_(d.ua));
  if (d.connected) bits.push('드라이브 ' + d.connected);
  if (d.entries) bits.push('기록 ' + d.entries + '편');
  if (d.built) bits.push('앱 ' + String(d.built).slice(0, 10));
  if (d.page && d.page !== 'index.html') bits.push('쪽 ' + d.page);
  if (d.lang && d.lang.indexOf('ko') !== 0) bits.push('언어 ' + d.lang);
  if (d.clientId) bits.push('기기 ' + d.clientId);
  if (d.id) bits.push('#' + d.id);
  return bits.join(' · ');
}

/**
 * 긴 UA 문자열을 「Chrome 148 · Windows」 정도로 줄인다.
 * ⚠️ 원문 400자를 그대로 칸에 넣어 두었더니, 그 칸 하나가 표를 다 밀어냈다.
 *    읽고 싶은 것은 «무슨 브라우저 · 무슨 기기» 이지 문자열이 아니다.
 */
function browser_(ua) {
  ua = String(ua || '');
  if (!ua) return '브라우저 모름';
  var name = 'Unknown', m = null;
  if (/Edg\//.test(ua))               { name = 'Edge';    m = /Edg\/(\d+)/.exec(ua); }
  else if (/SamsungBrowser/.test(ua)) { name = 'Samsung'; m = /SamsungBrowser\/(\d+)/.exec(ua); }
  else if (/Whale/.test(ua))          { name = 'Whale';   m = /Whale\/(\d+)/.exec(ua); }
  else if (/OPR\//.test(ua))          { name = 'Opera';   m = /OPR\/(\d+)/.exec(ua); }
  else if (/Firefox\//.test(ua))      { name = 'Firefox'; m = /Firefox\/(\d+)/.exec(ua); }
  else if (/Chrome\//.test(ua))       { name = 'Chrome';  m = /Chrome\/(\d+)/.exec(ua); }
  else if (/Safari\//.test(ua))       { name = 'Safari';  m = /Version\/(\d+)/.exec(ua); }

  var os = '기기 모름';
  if (/Windows/.test(ua))               os = 'Windows';
  else if (/Android/.test(ua))          os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua))         os = 'Mac';
  else if (/Linux/.test(ua))            os = 'Linux';

  return name + (m ? ' ' + m[1] : '') + ' · ' + os;
}

/**
 * 캡처 한 장을 드라이브에 담고 주소를 돌려준다.
 * 받는 꼴은 data URL (data:image/png;base64,…) 이다.
 *
 * ⚠️ 담을 자리는 «시트가 든 폴더» 안이다. 사람이 폴더 주소를 어디에 붙여 넣을 일이 없다 ·
 *    시트를 어디로 옮기든 캡처 폴더가 따라간다.
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
  /* ⚠️ 원래 이름에 이미 «.png» 이 붙어 있다. 그대로 두고 뒤에 또 붙이면
     「캡처확인.png.png」 이 된다 · 실제로 그렇게 쌓였다. 꼬리를 떼고 쓴다. */
  var safe = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '')
                               .replace(/[\\\/:*?"<>|]/g, '').slice(0, 40);
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

/**
 * 브라우저가 주소를 그냥 열어 봤을 때 · 살아 있는지와 «지금 깔린 판» 을 알려 준다.
 * ⚠️ 판 번호가 여기 보여야, 배포가 먹혔는지를 주소 한 번 열어서 확인할 수 있다.
 *    이게 없으면 「저장은 했는데 배포를 안 했다」 를 가려낼 길이 없다.
 */
function doGet() {
  return reply({ ok: true, ver: VER, note: '개인지식운영체제 · PKOS 의견 받는 자리입니다.' });
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
  var n = HEADERS.length;
  sh.getRange(1, 1, 1, n).setValues([HEADERS]).setFontWeight('bold').setBackground('#e8f2ee');
  // 칸을 줄인 판으로 갈아탈 때 옛 머리줄 글자가 오른쪽에 남지 않게
  var wide = sh.getMaxColumns();
  if (wide > n) sh.getRange(1, n + 1, 1, wide - n).clearContent();

  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);   // 접수시각
  sh.setColumnWidth(2, 90);    // 종류
  sh.setColumnWidth(3, 460);   // 내용
  sh.setColumnWidth(4, 210);   // 캡처
  sh.setColumnWidth(5, 150);   // 답 받을 곳
  sh.setColumnWidth(6, 100);   // 상태
  sh.setColumnWidth(7, 200);   // 처리 메모
  sh.setColumnWidth(8, 170);   // 어디서
  sh.setColumnWidth(9, 120);   // 자세히 · 좁게 둔다. 볼 일이 있으면 그때 넓힌다
  sh.getRange(1, 3, sh.getMaxRows(), 1).setWrap(true);
  sh.getRange(1, 7, sh.getMaxRows(), 1).setWrap(true);
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

/**
 * 시트 메뉴 → 「의견 받기」 → 「시험 줄 지우기」.
 * 붙이면서 시험 삼아 보낸 줄들을 한 번에 치운다.
 * ⚠️ 「내용」 이 대괄호로 시작하는 줄만 지운다 (예 · [연결 확인] · [캡처 시험]).
 *    사람이 보낸 진짜 의견은 그렇게 시작하지 않는다.
 */
function 시험줄지우기() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 3, n, 1).getValues();   // 「내용」 칸
  var gone = 0;
  for (var i = n - 1; i >= 0; i--) {                // 아래에서 위로 · 지우면 줄 번호가 밀린다
    if (/^\s*\[/.test(String(vals[i][0] || ''))) { sh.deleteRow(i + 2); gone++; }
  }
  SpreadsheetApp.getActive().toast(gone + '줄을 지웠습니다.', '의견 받기', 5);
}

/**
 * 시트 메뉴 → 「의견 받기」 → 「권한 주기」.
 *
 * ⚠️ 앱스 스크립트는 «코드가 무엇을 쓰는지» 를 보고 권한을 받는다. 캡처를 담는 코드가
 *    없던 판으로 승인해 두었다면, 새 판을 배포해도 드라이브 권한은 여전히 없다.
 *    그러면 글은 들어가는데 그림만 조용히 안 담긴다 · 실제로 그랬다.
 * 이걸 한 번 실행하면 승인 창이 뜬다. 허용하고 나면 그다음부터 캡처가 담긴다.
 * 하는 일은 «캡처 폴더를 만들어 두는 것» 뿐이라, 여러 번 눌러도 탈이 없다.
 */
function 권한주기() {
  var f = shotFolder_();
  SpreadsheetApp.getActive().toast(
    '드라이브 권한을 받았습니다. 캡처는 「' + f.getName() + '」 폴더에 담깁니다.', '의견 받기', 6);
}

/** 시트를 열면 메뉴 하나가 붙는다 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('의견 받기')
    .addItem('권한 주기 (캡처를 담으려면 한 번)', '권한주기')
    .addSeparator()
    .addItem('머리줄 세우기', '머리줄세우기')
    .addItem('시험 줄 지우기', '시험줄지우기')
    .addToUi();
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
