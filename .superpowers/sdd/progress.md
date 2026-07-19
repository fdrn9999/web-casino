# 베가스 카지노 — 진행 원장 (Subagent-Driven Development)

브랜치: build/casino-v1
플랜: docs/superpowers/plans/2026-07-19-plan-{1..7}-*.md

## 완료 태스크
(없음 — 시작)

## Minor 발견 사항 (최종 리뷰에서 triage)
(없음)

## P1 (기반)
- Task 2: complete (commits ea3f4e7..099b50d, review clean, 무결점)
- Task 3: complete (commits a334c31..f8ad42a, review clean, 무결점)
- Task 5: complete (commits 95bb240..fa97f4f, review clean)
  - Minor: signup 검증 분기 테스트 미포함(브리프 유래), 중복검사 비원자적(단일프로세스 무해)
- Task 6: complete (commits 2724411..37c5d3f, review clean) — 서버 테스트 18개
  - Minor: walletEvents 리스너 재구독 시 정리 없음(현재 1회 호출이라 무해, 최종리뷰 triage)
- Task 7: complete (commits de979e6..ed64209, review clean, 무결점) — 미사용 hero.png 잔존(무해)
- Task 8: complete (commits e8b6804..5f05efb, review clean, 무결점)
- Task 9: complete (commits 0ed98c3..a11faef, review clean, 무결점) — 클라 빌드 성공
- Task 10: 통합 검증 통과 (서버 18/18, 클라 빌드 성공, 브라우저 E2E: 인증·가입게이트·로비·잔액·로그아웃·admin 모두 정상)
- **Plan 1 완료**
- Task 4: complete (commits 4574c93..4876c00, review clean)
  - Minor: type enum 미검증(스코프외), rollback 비발행 테스트 없음(구조상 보장), 없는유저 bare Error
- Task 1: complete (commits 66b6c4a..ed2e6ea, review clean) — 포트 3000→4000 재조정 포함
  - Minor: task-1-report.md의 concerns가 포트 변경 전 상태 서술(코드 아닌 리포트 staleness)

## P2 (이코노미·관리자·공지)
- Task 2: complete (commits ffb27f4..b44663d, review approved) — 서버 27/27
- Task 3: complete (commits bdcee68..9e73612, review clean, 무결점) — 서버 30/30
- Task 4: complete (commits 2b33d4b..ffbea14, review approved+fix) — Important(ReliefModal 에러처리) fix 적용, 클라 빌드 성공
- Task 5: complete (commits b06ee96..460a5f4, review approved) — 클라 빌드 성공, 라우터 가드 async+fetchMe 검증
- Task 6: 통합 검증 통과 (서버 30/30, 클라 빌드, 라이브 API: 보너스·지급·차단·공지 전부 정상; 브라우저 렌더 확인). 참고: Chrome 도구 클릭 플레이키(read_page 기반 검증)
- **Plan 2 완료**
  - [최종triage] Minor: 거래 type snake_case 노출(한국어화), main.js+가드 fetchMe 레이스(무해)
  - [최종triage] Minor: 구제 임계값 100 클라 하드코딩(설정드리프트), 쿨다운0후 인터벌 지속, 출석버튼 미비활성
  - [최종triage] Minor: confiscate 'all' 0잔액시 400(no-op가 맞음), non-string reason→500(400이어야) — 브리프 유래
- Task 1: complete (commits df5bbe1..e575d22, review approved) — 서버 22/22
  - [최종triage] Important(plan-mandated, 동작정확): economy.js relief 400/429 분기가 reliefStatus 로직 중복 재유도 → reasonCode 반환으로 리팩터 권장

## P3 (슬롯·잭팟·사운드)
- Task 1: complete (commits 045aa82..8717afc, review approved) — 서버 33/33
- Task 2: complete (commits 53e5a1d..c69b470, review clean, 무결점) — 서버 38/38
- Task 3: complete (commits dada1ec..6ca9aba, review approved) — 서버 43/43
- Task 4: complete (commits 376079f..8f79228, review clean, 무결점) — jackpot.mp3 263KB, 클라 빌드
- Task 5: complete (commits 89a4796..dd508df, review approved) — 클라 빌드, 구현자 라이브검증(스핀·승패·풀 2탭 실시간)
- Task 6: 통합 검증 통과 (서버 43/43, 클라 빌드, 구현자 라이브검증, 잭팟 end-to-end: 스핀→지급→풀리셋→소켓 won+pool 브로드캐스트 전부 PASS)
- **Plan 3 완료**
  - [최종triage] Minor: SlotsView 스핀 인터벌 onUnmounted 미정리(이탈시 spinTick 잔존, 브리프 유래)
  - [최종triage] Important(비블로킹,브리프): spin 핸들러 단일 트랜잭션 아님(동기 sqlite라 실무위험 낮음); Minor: 잔액부족시 orphaned rounds행, bets.payout 합산저장
  - [최종triage] Minor(기존패턴): applyTransaction의 balance emit이 외부 트랜잭션 커밋 전 발행 가능(현재 무해)

## P4 (테이블·블랙잭)
- Task 1: complete (commits 447f895..a6f215b, review clean, 무결점) — 서버 46/46
- Task 2: complete (commits 19fc6ec..d5e3496, review approved, 독립재검증 51/51)
  - [최종triage] Minor: fromSplit 테스트 없음(수동검증 정확), doubled 파라미터 미사용(인터페이스 규약)
- security: 카드/슬롯 기본 RNG를 crypto CSPRNG로 (602616e) — CWE-338 대응(가상머니라 금전위험 없으나 편향제거)
- Task 3: complete (commits a6ea24f..b849763, review approved) — 서버 56/56
- Task 4: complete (commits 620b888..94f5314, review approved+fix) — 서버 59/59, vacuous 404 테스트 강화
- Task 5: complete (commits 0246b4a..0abb6de) — BlackjackRunner, 서버 70/70
- Task 6: complete (commits f305286..6a3b892, review approved, 독립재실행 72/72) — 게임 네임스페이스 소켓
- Task 7: complete (commits c20c250..afb4173, review approved) — 카드 SVG 54개, 매핑 52코드 검증, 클라 빌드
- Task 8: complete (commits 5bea17b..bb908c7, review+fix) — 테이블목록/관리자 테이블·규칙 화면, Important(테이블 수정UI) fix 적용
- Task 9: complete (commits 18657b4..109d12a, review+fix) — BlackjackView, 클라 빌드 성공
- Task 10: 통합 검증 통과 (서버 73/73, 클라 빌드). 브라우저 E2E: BlackjackView 라이브 렌더 + 소켓유저 착석·베팅을 admin 화면이 실시간 스냅샷으로 렌더(waiting→betting, 좌석·베팅액·타이머). 클릭불발은 도구한계.
- **Plan 4 완료** (테이블 CRUD·BlackjackRunner·라이브 블랙잭)
  - Critical fix: seat:leave arity 서버크래시 → 정규화+회귀테스트(73/73), 전역 예외가드, connect_error 피드백
  - [최종triage] Minor: 액션 버튼 in-flight 가드 없음(서버가 거부, UX노이즈)
  - [최종triage] Minor: CardImg srcFor 2회호출·props 미사용(P4T7 잔여)
  - Critical fix: 베팅중 이탈 칩소멸(inRound에 betting 누락) → 수정+회귀테스트, 재리뷰 승인
  - Important fix: 슈 언더플로 drawSafe, stop후 사용 가드; 테스트 결정화(딜러BJ flaky 제거)
  - [최종triage] Minor: dealer-BJ done 플래그(수정됨), drawSafe reshuffle는 라운드중 발생 가능(허용)
  - [최종triage] Minor(브리프): PUT 없는id 400(404여야), non-string name→500

## 사용자 추가 요청 (mid-flight)
- 슬롯 세로 스크롤 릴 연출 + 오토스핀: complete (커밋 dadcd9c→d0b5c86→8fde452)
  - 리뷰 2회: Important 2건(토글레이스·wait정리) + 재리뷰 Important 1건(토글오프 플래그) 모두 fix
  - 라이브 브라우저 검증(릴 스크롤·오토스핀 반복·잔액부족 자동정지). 잭팟-정지는 코드검증.
  - Plan7 Task4는 릴 재구현 스킵하도록 문서 조정(잭팟 풀스크린 연출만 남김)

## P5 (룰렛·바카라)
- Task 2: complete (commits ef4b809..3f598c4, review clean, 무결점) — 룰렛 엔진, 78/78
- Task 3: complete (commits 1212bf4..5610a2b, review approved, 재실행 자금흐름 안전) — RouletteRunner, 82/82
- Task 4: complete (commits 5523a17..82fb2d0, review approved, 드로잉표 80셀 전수검증) — 바카라 엔진, 88/88
- Task 5: complete (commits 88abe63..41b5bfc, review approved, 재실행+자금흐름 안전) — BaccaratRunner, 91/91
- Task 6: complete (commits 0be52a1..853edf3, review approved, 베팅페이로드 서버계약 일치검증) — 룰렛 화면, 클라 빌드
- Task 7: complete (commits 795cda2..0b53038, review approved) — 바카라 화면, 4게임 완성, 클라 빌드
- Task 8: 통합 검증 통과 (서버 91/91, 빌드). 브라우저 E2E: 룰렛(번호판·아웃사이드·소켓 실시간 베팅·2인 반영) + 바카라(5베팅버튼·페이즈·타이머) 라이브 렌더 확인.
- **Plan 5 완료** (룰렛·바카라)
  - [최종triage] Minor: 마지막이탈시 orphaned rounds행(reconcile가 처리), 20베팅캡 미테스트
- Task 1: complete (commits 54740bd..d506e4e, review clean, 무결점) — bet:place 일반화, 73/73

## P6 (통계·마이페이지·마무리)
- Task 1: complete (commits 996e39b..dc41607, review approved, 재실행 94/94) — 관리자 통계 API
- Task 2: complete (commits 68a8ee9..b8c1e09, review clean, 무결점) — 마이페이지 손익 API, 96/96
- Task 3: complete (commits ff96f7f..ce1becd, review approved, Chart 라이프사이클·데이터매핑 검증) — 통계 대시보드
- Task 4: complete (commits 88f2049..eb1ecbe, review approved) — 마이페이지 손익직면(음수 RED 정직표시)
- Task 5: complete (commits e3d33a5..1718bfa, review clean, 무결점) — 휴식 알림, 타이머정리 완비
  - [최종triage] Minor(반복): 여러 뷰 로딩/에러 상태 UI 없음(API 실패시 빈화면)
