# 플랜 8/8 — 참고 사이트 반영 기능 (HUD·리더보드·출석부·채팅) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 사용자가 참고한 라이브 카지노 사이트(Evolution/VG Asia/판도라)의 UX 요소 중 4가지를 **가상머니 앱에 맞게** 구현한다: ① 출석부(연속 출석 보상), ② 명예의 전당(리더보드), ③ 라이브 테이블 HUD 강화, ④ 테이블 라이브 채팅. **금전 요소(충전/환전/머니이전/페이백)는 절대 넣지 않는다.**

**Architecture:** 기존 코드 위에 additive. 출석부/리더보드는 REST + 클라 화면. HUD는 3개 테이블 뷰(blackjack/roulette/baccarat)의 표현 강화(서버 무변경). 채팅은 게임 네임스페이스(`/blackjack` 등)의 `table:{id}` room에 이벤트 추가 + 간단한 필터.

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

## Global Constraints

플랜 1~7의 Global Constraints 전체 적용. 추가:
- 현금/충전/환전/머니이전/페이백 관련 코드·UI·문구 절대 금지 (참고 사이트에는 있으나 우리는 제외).
- 모든 UI 한국어, 다크그린+골드 테마 유지, 모바일 반응형(가로 스크롤 금지).
- 잔액 변동은 반드시 `applyTransaction` 경유. 새 트랜잭션 타입 추가 시 기존 8종에 이어 명시(출석 보상은 기존 `daily_bonus`와 구분해 `attendance`로).
- 서버 스키마 변경은 `server/src/db/index.js`의 `createDb`에서 **idempotent 마이그레이션**(pragma table_info 확인 후 없으면 ALTER)으로 처리해, 기존 dev db(`server/data/casino.db`)도 재생성 없이 컬럼이 추가되게 한다.
- 채팅: 서버가 메시지를 신뢰하지 않는다 — 길이 제한(200자), 초당 과다 전송 rate limit(예: 2초당 1건), 간단한 금칙어 마스킹. XSS 방지를 위해 클라는 텍스트로만 렌더(v-html 금지).

## 물려받는 인터페이스 (변경 금지)
- `applyTransaction`, `getSettings`/`saveSettings`/`DEFAULT_SETTINGS`, `requireAuth`/`requireAdmin`, `createApp(db, ctx)`, `kstDateString`
- 게임: registry `getRunner`, `attachGameNamespace(io,db,gameKey)`, GAME_KEYS
- 클라: `api`, `useAuthStore`, `useGameSocket`, `useSocket`(onNotice 등 레지스트리 패턴), `PhaseTimer`, `SimpleChart`, `useSound`

---

### Task 1: 출석부 — 서버 (스키마 마이그레이션 + API)

**Files:**
- Modify: `server/src/db/index.js` (users에 `attendance_streak INTEGER NOT NULL DEFAULT 0`, `last_attendance TEXT` 컬럼 + idempotent 마이그레이션), `server/src/services/settings.js` (`DEFAULT_SETTINGS.economy`에 `attendanceRewards` 배열 추가)
- Create: `server/src/routes/attendance.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/attendance.test.js`

**Interfaces:**
- `DEFAULT_SETTINGS.economy.attendanceRewards = [1000, 1500, 2000, 2500, 3000, 4000, 5000]` (연속 1~7일차 보상, 7일 이후는 마지막 값 유지)
- 마이그레이션: `migrate(db)` — `PRAGMA table_info(users)`로 컬럼 존재 확인, 없으면 `ALTER TABLE users ADD COLUMN ...`. createDb의 `db.exec(SCHEMA)` 뒤에 호출. SCHEMA에도 컬럼을 추가(새 db는 바로 포함).
- `GET /api/attendance` (로그인) → `{ streak, todayClaimed, rewards, nextReward }` — 오늘(KST) 이미 출석했는지, 현재 연속 일수, 보상표, 다음 보상액.
- `POST /api/attendance` → 200 `{ streak, reward, balance }` / 409 `{ error: '오늘은 이미 출석했습니다.' }`
  - 로직: 오늘(KST) == last_attendance면 409. 어제였으면 streak+1, 아니면(공백) streak=1. 보상 = attendanceRewards[min(streak-1, len-1)]. `applyTransaction(type:'attendance', reason:'출석 N일차')`로 지급, last_attendance=today, attendance_streak=streak 저장.

- [ ] **Step 1: 실패 테스트** — `server/test/attendance.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'

async function signup(app, u='att1') {
  const r = await request(app).post('/api/auth/signup').send({ username:u, password:'password1', nickname:'출석', agreed:true })
  return { token:r.body.token, id:r.body.user.id }
}
describe('attendance', () => {
  let db, app, token, id
  beforeEach(async () => { db=createDb(); app=createApp(db,{}); ({token,id}=await signup(app)) })

  it('첫 출석은 1일차 보상 1000, streak 1', async () => {
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.status).toBe(200); expect(res.body.streak).toBe(1); expect(res.body.reward).toBe(1000)
    expect(res.body.balance).toBe(11000)
  })
  it('같은 날 두 번째는 409', async () => {
    await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    const dup = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(dup.status).toBe(409)
  })
  it('어제 출석 상태면 streak 증가(2일차 1500)', async () => {
    // 어제 날짜로 강제
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-1 day'), attendance_streak = 1 WHERE id = ?").run(id)
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.body.streak).toBe(2); expect(res.body.reward).toBe(1500)
  })
  it('공백(이틀 이상 전)이면 streak 리셋 1', async () => {
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-3 day'), attendance_streak = 5 WHERE id = ?").run(id)
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.body.streak).toBe(1)
  })
  it('GET status: todayClaimed 반영', async () => {
    const before = await request(app).get('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(before.body.todayClaimed).toBe(false)
    await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    const after = await request(app).get('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(after.body.todayClaimed).toBe(true); expect(after.body.streak).toBe(1)
  })
})
```
- [ ] **Step 2: RED** — `npm --prefix server test` → FAIL
- [ ] **Step 3: 구현**
  - `db/index.js`: SCHEMA의 users에 두 컬럼 추가, 그리고 export `migrate(db)`:
    ```js
    export function migrate(db) {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
      if (!cols.includes('attendance_streak')) db.exec("ALTER TABLE users ADD COLUMN attendance_streak INTEGER NOT NULL DEFAULT 0")
      if (!cols.includes('last_attendance')) db.exec("ALTER TABLE users ADD COLUMN last_attendance TEXT")
    }
    ```
    `createDb`에서 `db.exec(SCHEMA)` 뒤 `migrate(db)` 호출.
  - `settings.js`: economy에 `attendanceRewards: [1000,1500,2000,2500,3000,4000,5000]` 추가.
  - `routes/attendance.js`: `kstDateString`으로 오늘 판정, 어제 판정은 `kstDateString(new Date(Date.now()-86400000))`. streak 계산 후 `applyTransaction(type:'attendance', ...)`. `requireAuth(db)` 사용.
  - `app.js`: `app.use('/api/attendance', attendanceRouter(db))`.
  - 참고: `applyTransaction`은 type을 자유 문자열로 받으므로 'attendance' 그대로 기록 가능(스키마 CHECK 없음).
- [ ] **Step 4: GREEN** — 서버 테스트 누적 104개(99+5) 통과
- [ ] **Step 5: Commit** — `git commit -m "feat: 출석부 연속 출석 보상 API + 스키마 마이그레이션"`

---

### Task 2: 출석부 — 클라 (로비 출석 모달/캘린더)

**Files:**
- Create: `client/src/components/AttendanceModal.vue`
- Modify: `client/src/views/LobbyView.vue` (출석 보너스 버튼 옆에 "📅 출석부" 버튼 → 모달)

**Interfaces:**
- `AttendanceModal`: `show()` 노출. GET /api/attendance로 상태 로드, 7칸 캘린더(각 칸에 일차·보상액, 오늘까지 채워진 streak 강조), 오늘 미출석이면 "출석하고 N칩 받기" 버튼 → POST → 잔액 갱신(auth.setBalance) + 캘린더 갱신. 오늘 출석했으면 버튼 비활성 "오늘 출석 완료". 에러는 한국어 표시.

- [ ] **Step 1: 구현** — AttendanceModal.vue(Teleport 모달, 7칸 grid, 기존 ReliefModal 스타일 참고), LobbyView에 버튼+모달 ref 추가(기존 출석 보너스/파산구제/NoticeBoard/JackpotWidget/TableList 전부 보존).
- [ ] **Step 2: 빌드** — `npm --prefix client run build` 성공
- [ ] **Step 3: Commit** — `git commit -m "feat: 로비 출석부 모달(연속 출석 캘린더)"`

---

### Task 3: 명예의 전당 — 서버 API

**Files:**
- Create: `server/src/routes/leaderboard.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/leaderboard.test.js`

**Interfaces:**
- `GET /api/leaderboard` (로그인) → `{ richest[], biggestWins[], biggestLosers[] }`
  - `richest`: users 잔액 상위 10 `{nickname, username, balance}` (role='user'만).
  - `biggestWins`: transactions에서 단일 최대 지급(type IN payout,jackpot) 상위 10 `{nickname, amount, game, created_at}`.
  - `biggestLosers`: users 중 순손실(total_wagered - total_won) 상위 10 `{nickname, netLoss}` — **교육용**("가장 많이 잃은 사람" — 도박의 결과를 보여줌). netLoss>0만.

- [ ] **Step 1: 실패 테스트** — `server/test/leaderboard.test.js`: 유저 몇 명 생성 + 트랜잭션(bet/payout/jackpot) 넣고 세 목록의 정렬·필드 검증, 미로그인 401.
- [ ] **Step 2: RED**
- [ ] **Step 3: 구현** — `requireAuth(db)`, 파라미터화 쿼리. biggestWins는 `SELECT u.nickname, t.amount, t.game, t.created_at FROM transactions t JOIN users u ON u.id=t.user_id WHERE t.type IN ('payout','jackpot') ORDER BY t.amount DESC LIMIT 10`. biggestLosers는 `SELECT nickname, total_wagered-total_won netLoss FROM users WHERE role='user' AND total_wagered>total_won ORDER BY netLoss DESC LIMIT 10`.
- [ ] **Step 4: GREEN** — 누적 107개(104+3)
- [ ] **Step 5: Commit** — `git commit -m "feat: 명예의 전당 리더보드 API(부자·최대당첨·최대손실)"`

---

### Task 4: 명예의 전당 — 클라 (화면 + 로비 위젯 + 내비)

**Files:**
- Create: `client/src/views/LeaderboardView.vue`
- Modify: `client/src/router/index.js` (`/leaderboard` requiresAuth), `client/src/views/LobbyView.vue` (명예의 전당 진입 버튼/위젯), `client/src/App.vue`(선택: 헤더에 🏆 링크)

**Interfaces:**
- `LeaderboardView`: 3개 탭 또는 3개 섹션(💰 부자 랭킹 / 🎉 최대 당첨 / ⚠️ 최대 손실). 최대 손실 섹션엔 교육 문구("도박의 끝은 대부분 손실입니다"). 테이블 overflow-x-auto.
- 로비에 "🏆 명예의 전당" 버튼 → /leaderboard.

- [ ] **Step 1: 구현** — LeaderboardView + 라우트 + 로비 버튼(기존 보존).
- [ ] **Step 2: 빌드** 성공
- [ ] **Step 3: Commit** — `git commit -m "feat: 명예의 전당 화면 + 로비 진입"`

---

### Task 5: 라이브 테이블 HUD 강화 (클라, 서버 무변경)

**Files:**
- Create: `client/src/components/TableHud.vue` (하단 잔고/총 베팅액 바 + 우상단 컨트롤 클러스터)
- Modify: `client/src/views/BlackjackView.vue`, `client/src/views/RouletteView.vue`, `client/src/views/BaccaratView.vue`

**Interfaces:**
- `TableHud`: props `{ myBet, statusLabel, rules }` (또는 각 뷰가 조립). 하단 고정 바: `잔고 💰 {balance}` + `이번 라운드 베팅 {myBet}`; 우상단 클러스터: 음소거 토글(useSound), 히스토리 토글(각 뷰의 history 표시), 로비로. 펠트/헤더에 규칙 문구(블랙잭 "블랙잭 3:2", 룰렛 한도, 바카라 배당) + 라운드 상태("곧 다음 게임"/"베팅하세요!").
- 각 뷰는 자신의 스냅샷에서 myBet(내 베팅 합)·statusLabel(페이즈 한글)·rules를 계산해 HUD에 전달. **기존 게임 로직/스냅샷 렌더/소켓/사운드 전부 보존** — HUD는 표현 추가.

- [ ] **Step 1: 구현** — TableHud 컴포넌트 + 3개 뷰에 조립(각 뷰의 기존 "로비로" 버튼/음소거는 HUD로 통합하거나 중복 없이 정리). 반응형 하단 바.
- [ ] **Step 2: 빌드** 성공
- [ ] **Step 3: Commit** — `git commit -m "feat: 라이브 테이블 HUD 강화(잔고/베팅 바·컨트롤 클러스터·규칙 문구)"`

---

### Task 6: 테이블 라이브 채팅 — 서버 (네임스페이스 이벤트 + 필터)

**Files:**
- Create: `server/src/games/chat.js` (sanitizeMessage/필터 + rate limit 헬퍼)
- Modify: `server/src/sockets/game-namespace.js` (chat:send 수신 → table:{id} room에 chat:message 브로드캐스트)
- Test: `server/test/chat.test.js`

**Interfaces:**
- `chat.js`: `sanitizeMessage(text) → { ok, text?|error? }` — trim, 1~200자 검증, 금칙어 마스킹(간단 배열 `['개새끼','시발',...]`을 `*`로), 빈 문자열/과길이 거부. `RateLimiter`(userId별 마지막 전송 시각, 2초 간격) — 테스트 위해 now 주입 가능.
- game-namespace의 각 소켓에 `chat:send { text }` 핸들러 추가: 테이블 입장(socket.data.tableId) 상태에서만, sanitize+rate limit 통과 시 `nsp.to('table:'+tableId).emit('chat:message', { nickname, text, at })`. cb로 `{ok}`/`{error}`.
- **소켓 유닛 테스트**: sanitize/rate limit 순수 함수 테스트 + (선택) socket.io-client로 chat:send→chat:message 왕복.

- [ ] **Step 1: 실패 테스트** — `server/test/chat.test.js`: sanitizeMessage(빈/200초과/금칙어/정상), RateLimiter(2초내 2번째 거부) 순수 함수 테스트. 소켓 왕복은 blackjack-socket 패턴 참고(선택 1건).
- [ ] **Step 2: RED**
- [ ] **Step 3: 구현** — chat.js 헬퍼 + game-namespace에 핸들러 추가(기존 table:join/seat/bet/action/seat:leave/disconnect 보존). 브로드캐스트는 table room으로만.
- [ ] **Step 4: GREEN** — 누적 약 111개(107+~4)
- [ ] **Step 5: Commit** — `git commit -m "feat: 테이블 라이브 채팅 서버(필터·rate limit·room 브로드캐스트)"`

---

### Task 7: 테이블 라이브 채팅 — 클라 (테이블 채팅 패널)

**Files:**
- Create: `client/src/components/TableChat.vue`
- Modify: `client/src/composables/useGameSocket.js` (onChat 리스너 + sendChat), `client/src/views/BlackjackView.vue`, `client/src/views/RouletteView.vue`, `client/src/views/BaccaratView.vue`

**Interfaces:**
- `useGameSocket`에 `onChat(fn)` + `sendChat(text)` 추가(기존 connect/emitAck/onState/disconnect 보존, socket.on('chat:message',...) 등록).
- `TableChat`: props `{ game }` 또는 각 뷰가 useGameSocket 공유. 메시지 목록(닉네임+텍스트, **텍스트로만 렌더 — v-html 금지**), 입력창+전송(200자 제한), 최근 50개 유지, 자동 스크롤. 모바일에서 접기 가능.
- 3개 뷰에 TableChat 패널 추가(사이드 또는 하단, 기존 레이아웃 보존).

- [ ] **Step 1: 구현** — useGameSocket 확장 + TableChat + 3개 뷰 조립. XSS 방지 위해 반드시 `{{ msg.text }}`(텍스트 보간)만 사용.
- [ ] **Step 2: 빌드** 성공
- [ ] **Step 3: Commit** — `git commit -m "feat: 테이블 라이브 채팅 클라(패널·전송·텍스트 렌더)"`

---

### Task 8: 통합 검증 + 최종 전체 E2E

- [ ] **Step 1: 전체 테스트** — `npm --prefix server test` (약 111개 전부 통과), `npm --prefix client run build` 성공.
- [ ] **Step 2: 기능 브라우저 검증** — dev 기동 후:
  1. 출석부: 로비 📅 출석부 → 캘린더 → 출석 → 보상 지급+streak 표시, 재출석 시 완료 표시.
  2. 명예의 전당: /leaderboard → 부자/최대당첨/최대손실 3섹션 실제 데이터 렌더.
  3. 테이블 HUD: 블랙잭/룰렛/바카라 입장 시 하단 잔고/베팅 바 + 규칙 문구 + 상태 표시.
  4. 채팅: 두 창에서 같은 테이블 입장 → 한 창에서 메시지 전송 → 다른 창에 실시간 표시, 금칙어 마스킹, 200자/rate limit 동작.
  5. 반응형 375px: 4기능 전부 가로 스크롤 없이 조작 가능.
  6. 금전 요소(충전/환전) 어디에도 없음 확인.
- [ ] **Step 3: 최종 전체 회귀** — 인증·4게임·관리자·통계·이펙트가 여전히 정상인지 스모크(로그인→각 게임 1회→관리자 통계→마이페이지).
- [ ] **Step 4: Commit** — `git commit -m "chore: 플랜 8 완료 — 참고사이트 반영 4기능 검증 통과"`

## 범위 제외 (재확인)
- 충전/환전/머니이전/토큰게임/페이백 등 모든 현금·환전 기능. 멀티테이블 동시 플레이. 채팅 신고/영구밴(관리자 차단으로 갈음). 리더보드 실시간 소켓 갱신(새로고침/재진입 시 갱신으로 충분).
