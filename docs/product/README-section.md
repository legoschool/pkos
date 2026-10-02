<!-- PRODUCT-SHOWCASE:START -->
## 전체 기능과 화면 목업

**PKOS · 나의지식서재 — Personal Knowledge Organization System**

자료를 사업과 실제 경험에 연결하고, 그때의 생각을 다음 수업과 AI 협업에 다시 꺼내 쓰는 지식운영체계를 만들고 있습니다. 경험이 중심입니다. [목적과 사용 방법](docs/experience-records.md)을 읽거나 아래 화면을 눌러 흐름을 살펴볼 수 있습니다.

**[실제 나의지식서재 열기](https://legoschool.github.io/pkos-library/)** · [앱 사용 안내·기존 기록 이동](https://legoschool.github.io/pkos-library/guide.html)

**[버튼을 눌러 보는 공개 목업](https://legoschool.github.io/pkos/docs/mockup/)** · [전체 기능 상태](docs/product/FEATURES.md) · [앞으로의 갱신 기준](docs/product/MAINTENANCE.md)

아래 그림은 화면 설계 목업입니다. 가상 자료입니다. 실제 저장·변환·로그인·AI 전송·승인·게시를 실행하지 않으며, 이전 PKOS NEW와 별도 검토판의 기능을 한 제품으로 통합했다고 표시하지 않습니다.

### 작업실과 사업 기록

[![작업실 목업: 사업 기록 이어 보기, 자료 모으기, 회고와 공개 준비](docs/mockup/overview.svg)](https://legoschool.github.io/pkos/docs/mockup/#home)

### 원문 옆에서 생각 남기기

[![기록 목업: 원문과 현재 회고를 나란히 확인](docs/mockup/record.svg)](https://legoschool.github.io/pkos/docs/mockup/#record)

### 공개 범위와 승인 흐름

[![공개 준비 목업: 고른 자료만 공개하고 승인 버전을 구분](docs/mockup/publish.svg)](https://legoschool.github.io/pkos/docs/mockup/#publish)

### 기능별 현재 상태

기준일: 2026-09-28. 개인 서재 항목은 온라인 앱에 배포했습니다. 별도 로컬 검토판·샘플·설계 항목은 별도 상태이며, 전체 제품에 모든 계획 기능이 통합된 것은 아닙니다.

| 기능 | 상태 | 현재 확인한 범위 | 남은 일 |
|---|---|---|---|
| [자료 찾기·가져오기](https://legoschool.github.io/pkos/docs/mockup/#collect) | 로컬 검증 | 파일별 가져오기 결과와 내용 해시 중복 확인, 기존 메모 열기 | 노션·블로그·유튜브 전체 자동 수집 |
| [문서 변환·원문 대조](https://legoschool.github.io/pkos/docs/mockup/#record) | 로컬 검증 | PDF 본문·쪽, DOCX/PPTX/HWPX 글·이미지 추출과 재변환 비교 | OCR·구형 HWP·모든 문서의 원본 배치 재현 |
| [사업·연도별 활동](https://legoschool.github.io/pkos/docs/mockup/#projects) | 샘플 검증 | 드론 로컬 샘플의 사업 후보·연도·활동 종류 필터 | 공문 대조·역할·참여자 확정, 기존 앱과 통합 |
| [내 생각·사실 수정](https://legoschool.github.io/pkos/docs/mockup/#record) | 로컬 검증 | 자료 옆 메모·출처·변경 이력, 샘플 회고와 수정 의견 내보내기 | 사업 회고의 영구 수정 이력·시트 연결 |
| [PC 사본·기존 자료 정리](https://legoschool.github.io/pkos/docs/mockup/#collect) | 로컬 검증 | 폴더 내보내기·외부 편집 비교·선택 반영·되돌리기, 이전 형식 가져오기 | 사용자 폴더 권한·임의 폴더 자동 감시·대량 적용 |
| [자료 연결·지식맵](https://legoschool.github.io/pkos/docs/mockup/#map) | 로컬 검증 | 직접 연결·이유·숨김·복원, 2D/3D 지도와 계산한 유사도 | AI 의미 연결·관계 변경의 영구 복구 |
| [AI와 자료 읽기](https://legoschool.github.io/pkos/docs/mockup/#ai) | 모의 검증 | 전송 전 범위 확인·답변 별도 보관·채택·기각·인용 대조 | 실제 유료 호출·응답 품질·비용 운영 |
| [백업·복원·충돌 처리](https://legoschool.github.io/pkos/docs/mockup/#status) | 로컬 검증 | 전체 백업·별도 작업실 복원·오래된 탭 쓰기 차단 | 실물 다른 PC·기기에서의 왕복 검증 |
| [Drive 반영 확인](https://legoschool.github.io/pkos/docs/mockup/#status) | 실계정 확인 전 | 로그인·사본 대조 코드와 모의 검사 | 실제 계정 인증·전체 대조·다른 기기 수신 |
| [선택 공개·버전·철회](https://legoschool.github.io/pkos/docs/mockup/#publish) | 로컬 검증 | HTML/ZIP·공개 버전·고정 경로 준비·갱신과 철회 묶음 | 실제 인터넷 갱신·권한·철회 운영 |
| [비공개 시트·관리자 승인](https://legoschool.github.io/pkos/docs/mockup/#publish) | 설계 | 사업·활동·자료·참여자·회고·승인 CSV 구조 | Google Sheets 연결·서버 인증·권한·버전 승인 |
| [출처를 찾는 RAG](https://legoschool.github.io/pkos/docs/mockup/#ai) | 설계 | 개인 샘플의 출처 구간과 자료 번호 준비 | 검색 서비스·권한별 색인·수정 및 철회 반영 |
| [경험 탐색·프로필](https://legoschool.github.io/pkos/docs/mockup/#projects) | 설계 | 연도·주제·활동 종류별 탐색 구조 | 공개 탐색 통합, 프로필 제작·업로드는 마지막 |
| [개인 서재 · 원본과 충돌 보존](https://legoschool.github.io/pkos/docs/mockup/#status) | 온라인 배포 · 로컬 검증 | MD/TXT 원본 바이트 보관·첨부 원자 저장·필터 초기화·충돌 사본 UI·현재 기능 상태 안내 | 실제 기기 간 동기화와 앱 종료 후 폴더 감시는 미통합 |
| [개인 서재 · 문서 본문과 이미지 추출](https://legoschool.github.io/pkos/docs/mockup/#record) | 온라인 배포 · 로컬 검증 | DOCX·PPTX·HWPX·XLSX 본문과 내장 이미지·PDF 쪽별 본문·원본 연결·실패 재시도·백업 · 온라인에서는 브라우저 안에서 처리하며 서버 업로드 없음 | 스캔 OCR·옛 HWP·XLS·원본 배치와 서식 재현 |
| [개인 서재 · 실제 기록 3D 지도](https://legoschool.github.io/pkos/docs/mockup/#map) | 온라인 배포 · 로컬 검증 | 2D와 동일 기록·연결 기준·회전·확대·기록 열기·연결 이유·모바일·시점 보관 | AI 의미 분석·자동 개념 분류·대규모 전체 지도 |
| [개인 서재 · PC 폴더 자동 백업](https://legoschool.github.io/pkos/docs/mockup/#status) | 온라인 배포 · 로컬 검증 | 변경 감지·주기 백업·중복 생략·내용 재검증·권한 재연결·다중 창 잠금·마지막 성공 표시 | 실제 사용자 폴더 연결·앱 종료 후 실행·양방향 및 기기 간 동기화 |
| [개인 서재 · 연결 폴더 새 파일 확인](https://legoschool.github.io/pkos/docs/mockup/#collect) | 온라인 배포 · 로컬 검증 | 하위 폴더·내용 해시 비교·선택 가져오기·변경 사본 연결·원본 바이트·주기 확인·권한 복구·다중 창 중복 방지 | 실제 사용자 폴더 연결·앱 종료 후 감시·대규모 전체 폴더·양방향 동기화 |
| [개인 서재 · 읽기용 웹문서](https://legoschool.github.io/pkos/docs/mockup/#publish) | 온라인 배포 · 로컬 검증 | 기록 선택·첨부 개별 선택·분류 정보 선택·미리보기·ZIP·목차·내부 링크·원본 바이트·모바일 | 온라인 게시·계정별 접근 제한·배포본 갱신과 철회 |

화면과 기능이 바뀌면 이 표·설계 이미지·목업·사용법을 함께 갱신합니다. 기준을 남깁니다. 기능 상태는 `docs/product/features.json`에서 관리하고 생성 문서는 검사 명령으로 차이를 확인합니다.
<!-- PRODUCT-SHOWCASE:END -->
