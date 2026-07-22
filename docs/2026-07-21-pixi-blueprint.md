# PixiJS 렌더링 전환 — 구현 청사진 (설계 산출물)

> 작성: 2026-07-21 · 근거: 5개 서브에이전트 워크플로(소켓 계약 매핑 · 애니메이션 패리티 · 에셋 인벤토리 · Pixi v8 베스트프랙티스 · 종합 설계)
> 상위 계획: `2026-07-21-pixi-transition-plan.md` (전환 로드맵) · 본 문서는 그 Phase A/B의 실구현 스펙.

## 원칙 (불변)
- **서버 권위 유지**: 게임 로직·정산·검증은 `*Runner.js` 그대로. Pixi는 `table:state` 스냅샷을 소비하는 **표현 계층 전용**.
- **DOM과 병행**: 기존 DOM 렌더러를 건드리지 않고 `?pixi=1`/localStorage 플래그로 전환. 파리티 도달 전까지 DOM이 기본.
- **접근성 DOM 오버레이**: 카드 텍스트·베팅 목록·에러·aria-live는 캔버스 밖 DOM에 유지. 캔버스는 `aria-hidden` 장식.
- **prefers-reduced-motion**: reveal 큐 타이밍/연출 스킵 분기 그대로 이식. 단 **사운드는 모션과 무관하게 항상 발화**(useSound가 Vue와 분리된 순수 모듈이라 씬에서 직접 `sfx.*` 호출).

## Phase A — 공용 엔진 (✅ 2026-07-21 구현·브라우저 검증 완료)
설치: `pixi.js@8` (단일 배럴 import). 게임 라우트에서만 lazy-load(번들 ~65KB gzip, DOM 유저는 미다운로드).

생성된 파일:
- `client/src/pixi/PixiStage.vue` — Application 1개 마운트, `resizeTo` 컨테이너, `autoDensity`+DPR, 파괴 시 `app.destroy({removeView},{children,texture,textureSource})`, WebGL 실패 시 fallback. StageContext(`{app,stage,screen,reducedMotion,sfx,tween,delay}`)를 씬에 주입.
- `client/src/pixi/Scene.js` — 추상 베이스. `build/layout/onState/destroy` + ticker 자동 정리.
- `client/src/pixi/tween.js` — `makeTween/makeDelay`. **모든 타이밍이 app.ticker에 묶여** 파괴 시 함께 정리(raw setTimeout 금지 → 누수 방지). duration<=0이면 즉시 점프(reduced-motion 경로).
- `client/src/pixi/easing.js` — CSS와 1:1인 cubic-bezier(뉴턴법): `shoeTravel(0.2,0.75,0.3,1)`, `cardFlip(0.3,0.1,0.2,1)`, `overshoot(0.34,1.56,0.64,1)`, `wheelDecel(0.15,0.6,0.15,1)`.
- `client/src/pixi/assets.js` — **카드 SVG를 직접 텍스처로 로드**(아틀라스 굽기/네이티브 의존성 없이). `import.meta.glob` URL → `Assets.load`. `codeToFrame`/`loadCardTextures`/`cardTexture`/`fullDeckCodes`.
- `client/src/pixi/input.js` — `hit()`(히트영역 확대, 모바일 44px), `onTap()`(pointertap = 마우스+터치 통합).
- `client/src/pixi/objects/CardSprite.js` — 앞면(SVG 텍스처)/뒷면(Graphics). `dealIn`(슈에서 0.3s 이동 + 260ms 뒤 자가 플립), `flipTo`(BACK→실카드 0.42s scaleX 뒤집기), `snap`(즉시). CardImg.vue 타이밍 그대로.
- `client/src/pixi/scenes/DemoScene.js` + `client/src/views/PixiDemoView.vue` (`/pixi-demo`) — 펠트·슈·딜러 나란히·플레이어 캐스케이드·칩 스택을 렌더해 파이프라인 검증. **검증됨**: 실제 A♠/K♦ SVG 텍스처 로드, 슈 딜+플립 애니메이션, 액면별 칩 두께, 콘솔 에러 0.

## Phase B — BlackjackScene (✅ 2026-07-22 구현·라이브 라운드 검증 완료)
`client/src/pixi/scenes/BlackjackScene.js` + `client/src/pixi/BlackjackPixi.vue`(async 래퍼).
BlackjackView 헤더의 "✨ 그래픽 화면(베타)" 토글(또는 `?pixi=1`/localStorage)로 전환하며, 기본은 DOM.
검증됨(실 라운드): 캔버스 좌석 탭 착석 → 즉시 베팅 → 자동 시작 → 딜러 3♦+홀카드 나란히 딜 →
내 좌석 7♥7♠ 캐스케이드·플레이트(닉네임/칩/합계) → 정산(+200) → 카드 슈 회수 → 셔플 리플 복귀, 콘솔 에러 0.
사운드 분담: 카드 딜/플립은 씬(applyStep), 승패/셔플/칩·플로팅·칩샤워는 뷰(양 모드 공통) — 이중 재생 없음.
토글 시 뷰의 DOM 표시 계층은 정지(픽시 모드)/seedDisplay 재동기화(DOM 복귀).
원 계획 문서의 설계 세부(아래)는 구현 참고용으로 유지:
- `revealedDealer/revealedSeats` 미러가 CardSprite 생성을 구동(Vue ref 대신). `planned.*` 부기, 디스패치 순서(hardReset→freshDeal→diffAndEnqueue), 스플릿 재배치, 홀카드 플립 가드, `tickQueue` 지연(seat/upcard 340ms · dealerFlip 480ms · dealerDraw 520ms) 그대로.
- `applyStep`에서 `sfx.cardDeal()/cardFlip()`을 오늘과 동일하게 호출 → reduced-motion(즉시 표시)에서도 사운드는 순차 발화.
- 레이아웃: 딜러 나란히(dy=0), 7좌석 반원(nth-child y오프셋 이식), 캐스케이드 겹침(card-w = 스프라이트 폭), 슈 리플 루프 + to-shoe 트랜지션.
- 결과 피드백: `sfx.win/lose` + WinCascade/FloatingText는 **기존 DOM 컴포넌트 재사용**(오버레이). 승리 좌석 fx-glow-win, 활성 좌석 fx-pulse-gold.
- 베팅/액션 버튼은 **양 모드 모두 DOM 유지**(emitAck 구동·접근성). 캔버스는 펠트/카드/칩 시각화 전용.
- 플래그: `BlackjackView.vue`에 `usePixi = route.query.pixi==='1' || localStorage.pixi`. `<PixiStage v-if=usePixi>` + 접근성 오버레이, `v-else` 기존 DOM 트리(무수정). 씬은 `game.onState`에 **추가** 구독 + 진행 중 라운드 `seedDisplay` 스냅.

## 파리티 체크리스트(블랙잭) — Phase B 완료 게이트
딜 순서/타이밍(340/480/520ms), 홀카드 face-down→flip, 스플릿 즉시 재배치, 중도 이탈 좌석 정리, hardReset 즉시, seed 미딜, 총합 표시 조건, 카드별 슈 이동 0.3s+260ms 플립, 셔플 사운드 1회, 결과 사운드/캐스케이드/플로팅, **reduced-motion: 모든 카드 즉시 표시하되 deal/flip 사운드는 순차 발화 / WinCascade burst early-return / 카운트다운 비프 유지**, 접근성 오버레이, 로직 비파생, 플래그 off 시 DOM 무차이.

## Phase C~E (✅ 2026-07-22 구현·라이브 검증 완료)
설계 원칙 확립: **"뷰가 로직을 계속 굴리고, 씬은 표시만 미러링"** — 게임 로직·타이밍·사운드를 복제하지 않아
이중 재생·드리프트가 원천 차단된다. 전 게임 공통 토글(localStorage `pixi`) + `?pixi=1`.
- **C 바카라** `BaccaratScene`: 뷰의 순차 공개 미러(revealedPlayer/Banker)를 watch로 받아 카드만 그린다
  (슈 딜+플립, 리셋 시 슈 회수, 승자 구역 골드 테두리, 베팅 중 슈 리플). 중국점 로드는 DOM 유지 + **항상 표시**(빈 격자 포함).
  검증: 픽시 모드 풀 라운드(베팅→정산 +95→원매/빅로드 갱신), 콘솔 에러 0.
- **D 룰렛** `RouletteScene`: 휠 상수를 `lib/rouletteWheel.js`로 추출해 DOM과 공유. 포켓 링/방사 숫자/볼을
  Graphics로 그리고 스핀을 ticker 트윈(wheelDecel)으로 프레임 제어. 62% 지점 볼 낙하+바운스.
  검증: 결과 22가 12시 포인터 정착 + 볼이 22 포켓 안 정착(볼 기준각 90° 버그 발견·수정), 정산 정상.
- **E 슬롯** `SlotsScene`: 뷰의 릴 상태(reelStrips/reelY/reelState/suspense/glow)를 매 프레임 getFrame()으로
  읽어 미러링(스핀 물리·정지 트윈·사운드는 뷰 로직 그대로). 검증: 스핀→정착(🔔🍒🔔)·잭팟 적립·정산 정상.
구 DOM 뷰는 계속 병행(기본값) — 파리티 신뢰가 쌓이면 기본 전환 검토.

## 심화 폴리시 (✅ 2026-07-22 구현)
- **승리 골드 파티클** `pixi/objects/particles.js` — 씬 ticker 부기를 재사용하는 자체 정리 버스트.
  블랙잭(승리 좌석 위) · 바카라(승자 구역, 타이면 양쪽) · 룰렛(결과 배지 스파클) · 슬롯(당첨 글로우 에지). reduced-motion 시 생략.
- **바카라 스퀴즈** `CardSprite.squeezeIn/_peelTo` — 3번째(승부) 카드를 뒷면 도착 후 900ms에 걸쳐
  세로로 천천히 젖혀 까는 연출(0.55 지점 텍스처 스왑 + 기울임). 데모 씬에도 적용.
- **슬롯 릴 모션 블러** — BlurFilter 세로 블러(회전 7/감속 3/정지 0, 상태 변화 시에만 갱신). 실측 캡처로 확인.

## 리스크/대응
번들→라우트 dynamic import·아틀라스 HTTP 캐시 / WebGL 실패→try-catch로 DOM 폴백(빈 캔버스 금지) / 누수→ticker 기반 타이밍·destroy 옵션·ResizeObserver 해제·shallowRef(Pixi 객체 반응형 금지) / 파리티 드리프트→reveal 큐 복사 이식·체크리스트 회귀 게이트.

## 권고
현재 사용자가 DOM 게임을 활발히 다듬는 중이므로, DOM 게임플레이가 안정된 뒤 Phase B를 진행하는 것이 재이식 낭비를 줄인다. Phase A 기반은 `/pixi-demo`에서 언제든 확인 가능.
