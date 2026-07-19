# 플랜 5/6 — 룰렛 · 바카라 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플랜 4의 테이블·러너 인프라 위에 룰렛(유러피언)과 바카라(표준 드로잉 룰)를 멀티플레이어 라이브 테이블로 완성한다.

**Architecture:** 두 게임 모두 좌석 없는 참가자 모델(테이블 입장 = 참가)이다. 라운드당 여러 베팅 허용. 룰렛 인사이드 베팅은 `번호 배열 + (36−n)/n 배당 공식`으로 일반화해 스트레이트~식스라인을 하나의 코드 경로로 처리한다. 소켓 계층은 플랜 4의 `bet:place`를 페이로드 객체로 일반화한다(블랙잭 하위 호환 유지).

**Tech Stack:** 기존과 동일

## Global Constraints

플랜 1~4의 Global Constraints 전체 적용. 추가:

- 룰렛은 유러피언(0 하나, 0~36). 인사이드 베팅 당첨 반환액 = `amount × 36 / numbers.length` (스테이크 포함), numbers 길이는 1·2·3·4·6만 허용.
- 바카라 카드 값: A=1, 10/J/Q/K=0, 합은 mod 10. 8덱 슈.
- 바카라 배당(반환액): 플레이어 2×, 뱅커 1.95×(내림), 타이 `1+tiePayout`×, 페어 `1+pairPayout`×. **타이 시 플레이어/뱅커 베팅은 원금 반환(push)**.
- 스핀/공개 연출 중에도 결과는 이미 서버 확정 — 스냅샷에 포함하고 클라가 연출만 지연.

## 물려받는 인터페이스 (변경 금지 — 단, Task 1의 명시적 수정 제외)

- 플랜 4 전체: registry, tables 서비스(`GAME_KEYS`에 roulette·baccarat 이미 포함됨), `attachGameNamespace`, `startRunner`/`RUNNER_CLASSES`, `useGameSocket`, `PhaseTimer`, `CardImg`, `TableList`, 관리자 테이블/설정 화면
- Runner 공통 계약: `playerCount()`, `snapshot()`, `start()`, `stop({refund})`, `onDisconnect(userId)`, `placeBet(userId, payload)`, `onSeatsChange` 콜백

---

### Task 1: 소켓 계층 일반화 (bet:place 페이로드 · onJoin 훅)

**Files:**
- Modify: `server/src/sockets/game-namespace.js`, `server/src/games/blackjack/BlackjackRunner.js`
- Test: 기존 테스트 전체 그대로 통과해야 함 (하위 호환 확인)

**Interfaces:**
- Produces:
  - `bet:place`의 페이로드 전체가 `runner.placeBet(userId, payload)`로 전달됨 (`{ amount }` 또는 룰렛/바카라 확장 필드)
  - `table:join` 성공 시 `runner.onJoin?.(userId, nickname)` 호출 (블랙잭은 onJoin 없음 — 옵셔널)
  - `BlackjackRunner.placeBet(userId, payload)` — `payload`가 숫자면 그대로, 객체면 `payload.amount` 사용 (하위 호환)

- [ ] **Step 1: 수정**

`server/src/sockets/game-namespace.js`의 `bet:place` 핸들러를 다음으로 교체:
```js
    socket.on('bet:place', (payload = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.placeBet(socket.data.userId, payload) : { error: '테이블에 먼저 입장하세요.' })
    })
```
`table:join` 핸들러의 `cb({ state: r.snapshot() })` 직전에 추가:
```js
      r.onJoin?.(socket.data.userId, socket.data.nickname)
```

`server/src/games/blackjack/BlackjackRunner.js`의 `placeBet` 시그니처를 다음으로 교체:
```js
  placeBet(userId, payload) {
    const amount = typeof payload === 'number' ? payload : payload?.amount
```
(이후 본문은 `amount` 그대로 사용 — 나머지 변경 없음)

- [ ] **Step 2: 회귀 확인 후 Commit**

Run: `npm --prefix server test`
Expected: PASS (65 tests — 기존 전부 그대로)

```bash
git add server/src
git commit -m "refactor: bet:place 페이로드 일반화 및 onJoin 훅"
```

---

### Task 2: 룰렛 엔진

**Files:**
- Create: `server/src/games/roulette/engine.js`
- Modify: `server/src/services/settings.js` (`DEFAULT_SETTINGS.roulette` 추가)
- Test: `server/test/roulette-engine.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_SETTINGS.roulette = { minBet: 100, maxBet: 10000, betSeconds: 20, spinSeconds: 5 }`
  - `RED: Set<number>`, `colorOf(n) → 'green'|'red'|'black'`
  - `OUTSIDE_TYPES = ['red','black','odd','even','low','high','dozen1','dozen2','dozen3','col1','col2','col3']` (배당: 이븐머니 1, 더즌·칼럼 2)
  - `validateBet({ type, numbers?, amount? }) → string | null` — 에러 메시지(한국어) 또는 null. type `'inside'`면 numbers는 0~36 고유 정수 배열, 길이 1·2·3·4·6
  - `spinResult(rng = Math.random) → 0~36 정수`
  - `betPayout({ type, numbers }, amount, result) → 반환액` (스테이크 포함, 패배 0)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/roulette-engine.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { colorOf, validateBet, spinResult, betPayout } from '../src/games/roulette/engine.js'

describe('roulette engine', () => {
  it('색상: 0은 그린, 1은 레드, 2는 블랙', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(2)).toBe('black')
  })

  it('인사이드 검증: 길이 1·2·3·4·6만, 범위·중복 체크', () => {
    expect(validateBet({ type: 'inside', numbers: [7] })).toBeNull()
    expect(validateBet({ type: 'inside', numbers: [1, 2, 3, 4, 5, 6] })).toBeNull()
    expect(validateBet({ type: 'inside', numbers: [1, 2, 3, 4, 5] })).toBeTruthy()
    expect(validateBet({ type: 'inside', numbers: [37] })).toBeTruthy()
    expect(validateBet({ type: 'inside', numbers: [1, 1] })).toBeTruthy()
    expect(validateBet({ type: 'nope' })).toBeTruthy()
    expect(validateBet({ type: 'red' })).toBeNull()
  })

  it('인사이드 배당: 36/n 공식', () => {
    expect(betPayout({ type: 'inside', numbers: [7] }, 100, 7)).toBe(3600)
    expect(betPayout({ type: 'inside', numbers: [7] }, 100, 8)).toBe(0)
    expect(betPayout({ type: 'inside', numbers: [1, 2, 3] }, 100, 2)).toBe(1200)
    expect(betPayout({ type: 'inside', numbers: [1, 2, 3, 4, 5, 6] }, 100, 6)).toBe(600)
  })

  it('아웃사이드 배당: 이븐머니 2배, 더즌·칼럼 3배, 0은 아웃사이드 전패', () => {
    expect(betPayout({ type: 'red' }, 100, 1)).toBe(200)
    expect(betPayout({ type: 'red' }, 100, 2)).toBe(0)
    expect(betPayout({ type: 'odd' }, 100, 9)).toBe(200)
    expect(betPayout({ type: 'low' }, 100, 18)).toBe(200)
    expect(betPayout({ type: 'high' }, 100, 19)).toBe(200)
    expect(betPayout({ type: 'dozen2' }, 100, 13)).toBe(300)
    expect(betPayout({ type: 'col1' }, 100, 4)).toBe(300)
    for (const type of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'col3']) {
      expect(betPayout({ type }, 100, 0)).toBe(0)
    }
  })

  it('spinResult는 0~36 정수', () => {
    expect(spinResult(() => 0)).toBe(0)
    expect(spinResult(() => 0.9999)).toBe(36)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/services/settings.js`의 `DEFAULT_SETTINGS`에 추가:
```js
  roulette: { minBet: 100, maxBet: 10000, betSeconds: 20, spinSeconds: 5 },
```

`server/src/games/roulette/engine.js`:
```js
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export function colorOf(n) {
  if (n === 0) return 'green'
  return RED.has(n) ? 'red' : 'black'
}

const OUTSIDE = {
  red: (n) => n > 0 && RED.has(n),
  black: (n) => n > 0 && !RED.has(n),
  odd: (n) => n > 0 && n % 2 === 1,
  even: (n) => n > 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19 && n <= 36,
  dozen1: (n) => n >= 1 && n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25 && n <= 36,
  col1: (n) => n > 0 && n % 3 === 1,
  col2: (n) => n > 0 && n % 3 === 2,
  col3: (n) => n > 0 && n % 3 === 0,
}

const OUTSIDE_MULT = {
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  dozen1: 2, dozen2: 2, dozen3: 2, col1: 2, col2: 2, col3: 2,
}

export const OUTSIDE_TYPES = Object.keys(OUTSIDE)

const INSIDE_SIZES = [1, 2, 3, 4, 6]

export function validateBet({ type, numbers } = {}) {
  if (type === 'inside') {
    if (!Array.isArray(numbers) || !INSIDE_SIZES.includes(numbers.length)) {
      return '인사이드 베팅은 번호 1·2·3·4·6개만 가능합니다.'
    }
    if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 36)) return '번호는 0~36이어야 합니다.'
    if (new Set(numbers).size !== numbers.length) return '중복된 번호가 있습니다.'
    return null
  }
  if (!OUTSIDE_TYPES.includes(type)) return '알 수 없는 베팅 종류입니다.'
  return null
}

export function spinResult(rng = Math.random) {
  return Math.floor(rng() * 37)
}

export function betPayout({ type, numbers }, amount, result) {
  if (type === 'inside') {
    return numbers.includes(result) ? Math.floor((amount * 36) / numbers.length) : 0
  }
  return OUTSIDE[type](result) ? amount * (OUTSIDE_MULT[type] + 1) : 0
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 70 tests)

```bash
git add server/src server/test/roulette-engine.test.js
git commit -m "feat: 룰렛 엔진 (유러피언, 인사이드 일반화 공식)"
```

---

### Task 3: RouletteRunner

**Files:**
- Create: `server/src/games/roulette/RouletteRunner.js`
- Modify: `server/src/games/index.js` (`RUNNER_CLASSES.roulette` 등록)
- Test: `server/test/roulette-runner.test.js`

**Interfaces:**
- Consumes: 룰렛 엔진, `applyTransaction`, `getSettings(db,'roulette')`, 플랜 4 Runner 공통 계약
- Produces (`new RouletteRunner({ db, nsp, table, timers?, rng?, onSeatsChange? })`):
  - 좌석 없음: `onJoin(userId, nickname)`이 참가 등록(첫 참가 시 betting 시작), `onDisconnect`가 해제. `sit`/`leave`/`action`은 `{ error: '이 게임에는 좌석이 없습니다.' }`
  - `placeBet(userId, { type, numbers?, amount })` — betting 페이즈, 참가자만, `validateBet` + 한도(테이블 오버라이드 우선) 검증, 즉시 차감. 라운드당 여러 베팅 허용(최대 20개/인)
  - 페이즈: `waiting → betting → spinning → result → betting…` (베팅 없으면 betting 반복). spinning 진입 시 결과 확정
  - snapshot: `{ tableId, name, phase, phaseEndsAt, players: [{ nickname }], bets: [{ nickname, type, numbers, amount }], result, history(최근 20개 [{ n, color }]), rules: { minBet, maxBet, betSeconds, spinSeconds } }`
  - 정산: 유저별 반환액 합산 `applyTransaction(payout)`, bets 행 기록, rounds 업데이트. `stop({refund})`은 미정산 베팅 전액 환불

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/roulette-runner.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { RouletteRunner } from '../src/games/roulette/RouletteRunner.js'

function makeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1
        pending.set(seq, fn)
        return seq
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fire() {
      const fns = [...pending.values()]
      pending.clear()
      fns.forEach((fn) => fn())
    },
  }
}

const fakeNsp = { to: () => ({ emit() {} }) }

describe('RouletteRunner', () => {
  let db, t, table, u1

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('r1', 'h', '룰렛러', 10000)").run()
    u1 = 1
    db.prepare("INSERT INTO tables (game, name) VALUES ('roulette', '룰렛1')").run()
    table = { id: 1, game: 'roulette', name: '룰렛1', limits_json: null }
    t = makeTimers()
  })

  it('참가하면 베팅이 시작되고, 좌석 이벤트는 거부된다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    expect(r.snapshot().phase).toBe('betting')
    expect(r.playerCount()).toBe(1)
    expect(r.sit(u1, '룰렛러', 0).error).toBeTruthy()
  })

  it('베팅: 즉시 차감, 검증 실패는 거부, 여러 베팅 허용', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    expect(r.placeBet(u1, { type: 'red', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(u1, { type: 'inside', numbers: [7], amount: 100 }).ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9400)
    expect(r.placeBet(u1, { type: 'inside', numbers: [1, 2], amount: 50 }).error).toBeTruthy() // 최소 미달
    expect(r.placeBet(u1, { type: 'nope', amount: 500 }).error).toBeTruthy()
  })

  it('풀 사이클: 마감 → 스핀(결과 확정) → 정산 → 다음 베팅. 7 스트레이트 적중 시 3600 지급', () => {
    const rng = () => 7 / 37 + 0.001 // spinResult → 7
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers, rng })
    r.onJoin(u1, '룰렛러')
    r.placeBet(u1, { type: 'inside', numbers: [7], amount: 100 })
    t.fire() // 베팅 마감 → spinning
    expect(r.snapshot().phase).toBe('spinning')
    expect(r.snapshot().result).toBe(7)
    t.fire() // settle → result
    expect(r.snapshot().phase).toBe('result')
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000 - 100 + 3600)
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(1)
    expect(r.snapshot().history[0]).toEqual({ n: 7, color: 'red' })
    t.fire() // 다음 betting
    expect(r.snapshot().phase).toBe('betting')
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    r.placeBet(u1, { type: 'red', amount: 1000 })
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/games/roulette/RouletteRunner.js`:
```js
import { validateBet, spinResult, betPayout, colorOf } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

const MAX_BETS_PER_USER = 20

export class RouletteRunner {
  constructor({ db, nsp, table, timers = null, rng = Math.random, onSeatsChange = () => {} }) {
    this.db = db
    this.nsp = nsp
    this.table = table
    this.timers = timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    }
    this.rng = rng
    this.onSeatsChange = onSeatsChange
    this.room = `table:${table.id}`
    this.phase = 'waiting'
    this.players = new Map() // userId → { nickname }
    this.bets = [] // { userId, nickname, type, numbers, amount }
    this.result = null
    this.history = []
    this.roundId = null
    this.rules_ = null
    this.settled = false
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  rules() {
    const s = getSettings(this.db, 'roulette')
    const limits = this.table.limits_json ? JSON.parse(this.table.limits_json) : null
    return limits ? { ...s, ...limits } : s
  }

  playerCount() {
    return this.players.size
  }

  broadcast() {
    this.nsp.to(this.room).emit('table:state', this.snapshot())
  }

  schedule(ms, fn) {
    this.clearTimer()
    this.phaseEndsAt = Date.now() + ms
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      if (!this.stopped) fn()
    }, ms)
  }

  clearTimer() {
    if (this.timer != null) {
      this.timers.clearTimeout(this.timer)
      this.timer = null
    }
    this.phaseEndsAt = null
  }

  snapshot() {
    const r = this.rules_ ?? this.rules()
    return {
      tableId: this.table.id,
      name: this.table.name,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      players: [...this.players.values()].map(({ nickname }) => ({ nickname })),
      bets: this.bets.map(({ nickname, type, numbers, amount }) => ({ nickname, type, numbers, amount })),
      result: this.result,
      history: this.history,
      rules: { minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds, spinSeconds: r.spinSeconds },
    }
  }

  sit() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  leave() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  action() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }

  onJoin(userId, nickname) {
    this.players.set(userId, { nickname })
    if (this.phase === 'waiting') this.startBetting()
    this.onSeatsChange()
    this.broadcast()
  }

  onDisconnect(userId) {
    this.players.delete(userId)
    if (this.playerCount() === 0 && this.phase === 'betting' && this.bets.length === 0) this.goWaiting()
    this.onSeatsChange()
  }

  placeBet(userId, payload = {}) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const player = this.players.get(userId)
    if (!player) return { error: '테이블에 먼저 입장하세요.' }
    if (this.bets.filter((b) => b.userId === userId).length >= MAX_BETS_PER_USER) {
      return { error: '한 라운드 베팅 개수 한도를 넘었습니다.' }
    }
    const err = validateBet(payload)
    if (err) return { error: err }
    const { amount } = payload
    const r = this.rules_
    if (!Number.isInteger(amount) || amount < r.minBet || amount > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, { userId, type: 'bet', amount: -amount, game: 'roulette', refRoundId: this.roundId })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    this.bets.push({ userId, nickname: player.nickname, type: payload.type, numbers: payload.numbers ?? null, amount })
    this.broadcast()
    return { ok: true }
  }

  goWaiting() {
    this.phase = 'waiting'
    this.clearTimer()
    this.broadcast()
  }

  startBetting() {
    if (this.stopped) return
    if (this.playerCount() === 0) return this.goWaiting()
    this.rules_ = this.rules()
    this.phase = 'betting'
    this.bets = []
    this.result = null
    this.settled = false
    const { lastInsertRowid } = this.db.prepare("INSERT INTO rounds (game, table_id) VALUES ('roulette', ?)").run(this.table.id)
    this.roundId = Number(lastInsertRowid)
    this.schedule(this.rules_.betSeconds * 1000, () => this.closeBetting())
    this.broadcast()
  }

  closeBetting() {
    if (this.bets.length === 0) {
      this.db.prepare('DELETE FROM rounds WHERE id = ?').run(this.roundId)
      this.roundId = null
      return this.startBetting()
    }
    this.result = spinResult(this.rng)
    this.phase = 'spinning'
    this.broadcast()
    this.schedule(this.rules_.spinSeconds * 1000, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.clearTimer()
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    const payoutByUser = new Map()
    for (const bet of this.bets) {
      const payout = betPayout(bet, bet.amount, this.result)
      insertBet.run(this.roundId, bet.userId, JSON.stringify({ type: bet.type, numbers: bet.numbers }), bet.amount, payout)
      payoutByUser.set(bet.userId, (payoutByUser.get(bet.userId) ?? 0) + payout)
    }
    for (const [userId, payout] of payoutByUser) {
      if (payout > 0) {
        applyTransaction(this.db, { userId, type: 'payout', amount: payout, game: 'roulette', refRoundId: this.roundId })
      }
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ n: this.result }), this.roundId)
    this.settled = true
    this.history.unshift({ n: this.result, color: colorOf(this.result) })
    this.history = this.history.slice(0, 20)
    this.broadcast()
    this.schedule(4000, () => this.startBetting())
  }

  refundAll() {
    for (const bet of this.bets) {
      applyTransaction(this.db, {
        userId: bet.userId, type: 'payout', amount: bet.amount, game: 'roulette',
        refRoundId: this.roundId, reason: '테이블 중단 환불',
      })
    }
    this.bets = []
  }

  start() {
    if (this.playerCount() > 0) this.startBetting()
    else this.goWaiting()
  }

  stop({ refund = true } = {}) {
    this.stopped = true
    this.clearTimer()
    if (refund && !this.settled && this.bets.length > 0) this.refundAll()
    this.nsp.to(this.room).emit('table:closed', {})
  }
}
```

`server/src/games/index.js` 수정:
```js
import { RouletteRunner } from './roulette/RouletteRunner.js'
// ...
export const RUNNER_CLASSES = { blackjack: BlackjackRunner, roulette: RouletteRunner }
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 74 tests)

```bash
git add server/src server/test/roulette-runner.test.js
git commit -m "feat: 룰렛 러너 (참가자 모델·다중 베팅)"
```

---

### Task 4: 바카라 엔진

**Files:**
- Create: `server/src/games/baccarat/engine.js`
- Modify: `server/src/services/settings.js` (`DEFAULT_SETTINGS.baccarat` 추가)
- Test: `server/test/baccarat-engine.test.js`

**Interfaces:**
- Consumes: 카드 형태 `{ rank, suit, code }`
- Produces:
  - `DEFAULT_SETTINGS.baccarat = { minBet: 100, maxBet: 10000, betSeconds: 20, revealSeconds: 4, tiePayout: 8, pairPayout: 11 }`
  - `BET_KINDS = ['player', 'banker', 'tie', 'ppair', 'bpair']`
  - `cardPoint(card) → 0~9`, `handTotal(cards) → 0~9`
  - `playRound(shoe) → { player, banker, playerTotal, bankerTotal, outcome, playerPair, bankerPair }` — 표준 드로잉 룰 (`shoe.pop()`으로 순서대로 뽑음)
  - `betPayout({ kind, amount }, result, rules) → 반환액` — 위 Global Constraints의 배당 규칙

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/baccarat-engine.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { cardPoint, handTotal, playRound, betPayout } from '../src/games/baccarat/engine.js'

const c = (rank) => ({ rank, suit: 'S', code: rank + 'S' })
// playRound는 shoe.pop()으로 뽑으므로 배열의 "뒤에서부터" 나간다.
// 뽑는 순서: P1, P2, B1, B2, (P3), (B3)
function shoeFor(cardsInDrawOrder) {
  return [...cardsInDrawOrder].reverse()
}
const rules = { tiePayout: 8, pairPayout: 11 }

describe('baccarat engine', () => {
  it('카드 값: A=1, 10/그림=0, 합은 mod 10', () => {
    expect(cardPoint(c('A'))).toBe(1)
    expect(cardPoint(c('10'))).toBe(0)
    expect(cardPoint(c('K'))).toBe(0)
    expect(handTotal([c('7'), c('8')])).toBe(5)
  })

  it('내추럴 8/9면 추가 드로우 없음', () => {
    const r = playRound(shoeFor([c('4'), c('4'), c('10'), c('9')])) // P=8, B=9
    expect(r.player.length).toBe(2)
    expect(r.banker.length).toBe(2)
    expect(r.outcome).toBe('banker')
  })

  it('플레이어 5 이하면 드로우, 뱅커는 3번째 카드 규칙 적용 (B=6, P3=7 → 뱅커 드로우)', () => {
    // P: 2+3=5 → 드로우 7 → 12→2. B: 10+6=6, P3=7 → 6은 6·7에 드로우
    const r = playRound(shoeFor([c('2'), c('3'), c('10'), c('6'), c('7'), c('2')]))
    expect(r.player.length).toBe(3)
    expect(r.banker.length).toBe(3)
    expect(r.playerTotal).toBe(2)
    expect(r.bankerTotal).toBe(8)
    expect(r.outcome).toBe('banker')
  })

  it('뱅커 3, 플레이어 3번째가 8이면 뱅커 스탠드', () => {
    // P: 2+2=4 → 드로우 8 → 12→2. B: 10+3=3, P3=8 → 스탠드
    const r = playRound(shoeFor([c('2'), c('2'), c('10'), c('3'), c('8')]))
    expect(r.banker.length).toBe(2)
    expect(r.outcome).toBe('banker') // 3 > 2
  })

  it('페어 감지', () => {
    const r = playRound(shoeFor([c('4'), c('4'), c('9'), c('K')])) // P페어, P=8 내추럴
    expect(r.playerPair).toBe(true)
    expect(r.bankerPair).toBe(false)
  })

  it('배당: 플레이어 2×, 뱅커 1.95×, 타이 9×, 페어 12×, 타이 시 메인 푸시', () => {
    const win = { outcome: 'player', playerPair: false, bankerPair: true }
    expect(betPayout({ kind: 'player', amount: 100 }, win, rules)).toBe(200)
    expect(betPayout({ kind: 'banker', amount: 100 }, win, rules)).toBe(0)
    expect(betPayout({ kind: 'bpair', amount: 100 }, win, rules)).toBe(1200)
    const banker = { outcome: 'banker', playerPair: false, bankerPair: false }
    expect(betPayout({ kind: 'banker', amount: 100 }, banker, rules)).toBe(195)
    const tie = { outcome: 'tie', playerPair: false, bankerPair: false }
    expect(betPayout({ kind: 'tie', amount: 100 }, tie, rules)).toBe(900)
    expect(betPayout({ kind: 'player', amount: 100 }, tie, rules)).toBe(100)
    expect(betPayout({ kind: 'banker', amount: 100 }, tie, rules)).toBe(100)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/services/settings.js`의 `DEFAULT_SETTINGS`에 추가:
```js
  baccarat: { minBet: 100, maxBet: 10000, betSeconds: 20, revealSeconds: 4, tiePayout: 8, pairPayout: 11 },
```

`server/src/games/baccarat/engine.js`:
```js
export const BET_KINDS = ['player', 'banker', 'tie', 'ppair', 'bpair']

export function cardPoint(card) {
  if (card.rank === 'A') return 1
  if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 0
  return Number(card.rank)
}

export function handTotal(cards) {
  return cards.reduce((sum, card) => sum + cardPoint(card), 0) % 10
}

export function playRound(shoe) {
  const draw = () => shoe.pop()
  const player = [draw(), draw()]
  const banker = [draw(), draw()]
  let playerTotal = handTotal(player)
  let bankerTotal = handTotal(banker)

  if (playerTotal < 8 && bankerTotal < 8) {
    let thirdPoint = null
    if (playerTotal <= 5) {
      player.push(draw())
      thirdPoint = cardPoint(player[2])
      playerTotal = handTotal(player)
    }
    const bankerDraws =
      thirdPoint === null
        ? bankerTotal <= 5
        : bankerTotal <= 2
          ? true
          : bankerTotal === 3
            ? thirdPoint !== 8
            : bankerTotal === 4
              ? thirdPoint >= 2 && thirdPoint <= 7
              : bankerTotal === 5
                ? thirdPoint >= 4 && thirdPoint <= 7
                : bankerTotal === 6
                  ? thirdPoint >= 6 && thirdPoint <= 7
                  : false
    if (bankerDraws) {
      banker.push(draw())
      bankerTotal = handTotal(banker)
    }
  }

  const outcome = playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie'
  return {
    player,
    banker,
    playerTotal,
    bankerTotal,
    outcome,
    playerPair: player[0].rank === player[1].rank,
    bankerPair: banker[0].rank === banker[1].rank,
  }
}

export function betPayout({ kind, amount }, result, rules) {
  switch (kind) {
    case 'player':
      if (result.outcome === 'player') return amount * 2
      return result.outcome === 'tie' ? amount : 0
    case 'banker':
      if (result.outcome === 'banker') return amount + Math.floor(amount * 0.95)
      return result.outcome === 'tie' ? amount : 0
    case 'tie':
      return result.outcome === 'tie' ? amount * (1 + rules.tiePayout) : 0
    case 'ppair':
      return result.playerPair ? amount * (1 + rules.pairPayout) : 0
    case 'bpair':
      return result.bankerPair ? amount * (1 + rules.pairPayout) : 0
    default:
      return 0
  }
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 80 tests)

```bash
git add server/src server/test/baccarat-engine.test.js
git commit -m "feat: 바카라 엔진 (표준 드로잉 룰·배당)"
```

---

### Task 5: BaccaratRunner

**Files:**
- Create: `server/src/games/baccarat/BaccaratRunner.js`
- Modify: `server/src/games/index.js` (`RUNNER_CLASSES.baccarat` 등록)
- Test: `server/test/baccarat-runner.test.js`

**Interfaces:**
- Produces: RouletteRunner와 동일한 참가자 모델·페이즈 구조. 차이점만:
  - `placeBet(userId, { kind, amount })` — kind는 `BET_KINDS`, 같은 kind 중복 베팅 시 금액 합산이 아니라 거부(라운드당 kind별 1회)
  - 페이즈: `waiting → betting → revealing → result → betting…`
  - 8덱 슈 사용, 남은 카드 20장 미만이면 리셔플
  - snapshot에 `result: { player: [{code}...], banker, playerTotal, bankerTotal, outcome, playerPair, bankerPair } | null`, `history(최근 30개 outcome 배열)` 포함

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/baccarat-runner.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { BaccaratRunner } from '../src/games/baccarat/BaccaratRunner.js'

function makeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1
        pending.set(seq, fn)
        return seq
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fire() {
      const fns = [...pending.values()]
      pending.clear()
      fns.forEach((fn) => fn())
    },
  }
}

const fakeNsp = { to: () => ({ emit() {} }) }

describe('BaccaratRunner', () => {
  let db, t, table

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('b1', 'h', '바카라러', 10000)").run()
    db.prepare("INSERT INTO tables (game, name) VALUES ('baccarat', '바카라1')").run()
    table = { id: 1, game: 'baccarat', name: '바카라1', limits_json: null }
    t = makeTimers()
  })

  it('베팅: kind 검증, 같은 kind 중복 거부', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).error).toBeTruthy()
    expect(r.placeBet(1, { kind: 'tie', amount: 100 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'wat', amount: 100 }).error).toBeTruthy()
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9400)
  })

  it('풀 사이클: 마감 → 공개(결과 확정) → 정산 → 다음 베팅, 잔액 보존 불변식', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'player', amount: 1000 })
    r.placeBet(1, { kind: 'ppair', amount: 100 })
    t.fire() // 마감 → revealing
    const snap = r.snapshot()
    expect(snap.phase).toBe('revealing')
    expect(snap.result.player.length).toBeGreaterThanOrEqual(2)
    t.fire() // 정산 → result
    expect(r.snapshot().phase).toBe('result')
    const balance = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balance).toBe(10000 - 1100 + payoutSum)
    expect(r.snapshot().history.length).toBe(1)
    t.fire()
    expect(r.snapshot().phase).toBe('betting')
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'banker', amount: 700 })
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/games/baccarat/BaccaratRunner.js`:
```js
import { buildShoe } from '../cards.js'
import { playRound, betPayout, BET_KINDS } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

export class BaccaratRunner {
  constructor({ db, nsp, table, timers = null, rng = Math.random, onSeatsChange = () => {} }) {
    this.db = db
    this.nsp = nsp
    this.table = table
    this.timers = timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    }
    this.rng = rng
    this.onSeatsChange = onSeatsChange
    this.room = `table:${table.id}`
    this.phase = 'waiting'
    this.players = new Map()
    this.bets = [] // { userId, nickname, kind, amount }
    this.result = null
    this.history = []
    this.shoe = []
    this.roundId = null
    this.rules_ = null
    this.settled = false
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  rules() {
    const s = getSettings(this.db, 'baccarat')
    const limits = this.table.limits_json ? JSON.parse(this.table.limits_json) : null
    return limits ? { ...s, ...limits } : s
  }

  playerCount() {
    return this.players.size
  }

  broadcast() {
    this.nsp.to(this.room).emit('table:state', this.snapshot())
  }

  schedule(ms, fn) {
    this.clearTimer()
    this.phaseEndsAt = Date.now() + ms
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      if (!this.stopped) fn()
    }, ms)
  }

  clearTimer() {
    if (this.timer != null) {
      this.timers.clearTimeout(this.timer)
      this.timer = null
    }
    this.phaseEndsAt = null
  }

  snapshot() {
    const r = this.rules_ ?? this.rules()
    return {
      tableId: this.table.id,
      name: this.table.name,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      players: [...this.players.values()].map(({ nickname }) => ({ nickname })),
      bets: this.bets.map(({ nickname, kind, amount }) => ({ nickname, kind, amount })),
      result: this.result,
      history: this.history,
      rules: {
        minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds,
        revealSeconds: r.revealSeconds, tiePayout: r.tiePayout, pairPayout: r.pairPayout,
      },
    }
  }

  sit() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  leave() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  action() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }

  onJoin(userId, nickname) {
    this.players.set(userId, { nickname })
    if (this.phase === 'waiting') this.startBetting()
    this.onSeatsChange()
    this.broadcast()
  }

  onDisconnect(userId) {
    this.players.delete(userId)
    if (this.playerCount() === 0 && this.phase === 'betting' && this.bets.length === 0) this.goWaiting()
    this.onSeatsChange()
  }

  placeBet(userId, { kind, amount } = {}) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const player = this.players.get(userId)
    if (!player) return { error: '테이블에 먼저 입장하세요.' }
    if (!BET_KINDS.includes(kind)) return { error: '알 수 없는 베팅 종류입니다.' }
    if (this.bets.some((b) => b.userId === userId && b.kind === kind)) {
      return { error: '이미 해당 항목에 베팅했습니다.' }
    }
    const r = this.rules_
    if (!Number.isInteger(amount) || amount < r.minBet || amount > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, { userId, type: 'bet', amount: -amount, game: 'baccarat', refRoundId: this.roundId })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    this.bets.push({ userId, nickname: player.nickname, kind, amount })
    this.broadcast()
    return { ok: true }
  }

  goWaiting() {
    this.phase = 'waiting'
    this.clearTimer()
    this.broadcast()
  }

  startBetting() {
    if (this.stopped) return
    if (this.playerCount() === 0) return this.goWaiting()
    this.rules_ = this.rules()
    this.phase = 'betting'
    this.bets = []
    this.result = null
    this.settled = false
    const { lastInsertRowid } = this.db.prepare("INSERT INTO rounds (game, table_id) VALUES ('baccarat', ?)").run(this.table.id)
    this.roundId = Number(lastInsertRowid)
    this.schedule(this.rules_.betSeconds * 1000, () => this.closeBetting())
    this.broadcast()
  }

  closeBetting() {
    if (this.bets.length === 0) {
      this.db.prepare('DELETE FROM rounds WHERE id = ?').run(this.roundId)
      this.roundId = null
      return this.startBetting()
    }
    if (this.shoe.length < 20) this.shoe = buildShoe(8, this.rng)
    this.result = playRound(this.shoe)
    this.phase = 'revealing'
    this.broadcast()
    this.schedule(this.rules_.revealSeconds * 1000, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.clearTimer()
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    const payoutByUser = new Map()
    for (const bet of this.bets) {
      const payout = betPayout(bet, this.result, this.rules_)
      insertBet.run(this.roundId, bet.userId, JSON.stringify({ kind: bet.kind }), bet.amount, payout)
      payoutByUser.set(bet.userId, (payoutByUser.get(bet.userId) ?? 0) + payout)
    }
    for (const [userId, payout] of payoutByUser) {
      if (payout > 0) {
        applyTransaction(this.db, { userId, type: 'payout', amount: payout, game: 'baccarat', refRoundId: this.roundId })
      }
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?").run(
      JSON.stringify({
        outcome: this.result.outcome,
        player: this.result.player.map((c) => c.code),
        banker: this.result.banker.map((c) => c.code),
      }),
      this.roundId
    )
    this.settled = true
    this.history.unshift(this.result.outcome)
    this.history = this.history.slice(0, 30)
    this.broadcast()
    this.schedule(4000, () => this.startBetting())
  }

  refundAll() {
    for (const bet of this.bets) {
      applyTransaction(this.db, {
        userId: bet.userId, type: 'payout', amount: bet.amount, game: 'baccarat',
        refRoundId: this.roundId, reason: '테이블 중단 환불',
      })
    }
    this.bets = []
  }

  start() {
    if (this.playerCount() > 0) this.startBetting()
    else this.goWaiting()
  }

  stop({ refund = true } = {}) {
    this.stopped = true
    this.clearTimer()
    if (refund && !this.settled && this.bets.length > 0) this.refundAll()
    this.nsp.to(this.room).emit('table:closed', {})
  }
}
```

`server/src/games/index.js` 수정:
```js
import { BaccaratRunner } from './baccarat/BaccaratRunner.js'
// ...
export const RUNNER_CLASSES = { blackjack: BlackjackRunner, roulette: RouletteRunner, baccarat: BaccaratRunner }
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 83 tests)

```bash
git add server/src server/test/baccarat-runner.test.js
git commit -m "feat: 바카라 러너"
```

---

### Task 6: 클라 — 룰렛 화면

**Files:**
- Create: `client/src/views/RouletteView.vue`
- Modify: `client/src/router/index.js` (`/roulette/:tableId`), `client/src/views/LobbyView.vue` (룰렛 `tables: true`), `client/src/views/admin/AdminSettingsView.vue` (GROUPS에 룰렛 추가)

**Interfaces:**
- Consumes: `useGameSocket('roulette')`, `PhaseTimer`, `useSound`, 스냅샷(Task 3)
- Produces: `/roulette/:tableId` — 번호판(0~36, 색상), 인사이드 다중 선택(1·2·3·4·6개), 아웃사이드 버튼(레드/블랙/홀/짝/로우/하이/더즌×3/칼럼×3), 금액 칩, 내 베팅·전체 베팅 목록, 스핀 연출(번호 롤링 → 결과 강조 + `sfx.spinStart`), 히스토리 스트립(색상 점)

- [ ] **Step 1: 구현**

`client/src/views/RouletteView.vue`:
```vue
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PhaseTimer from '../components/PhaseTimer.vue'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('roulette')

const state = ref(null)
const error = ref('')
const amount = ref(100)
const selected = ref([])
const rolling = ref(null)
let rollTimer = null

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const colorClass = (n) => (n === 0 ? 'bg-emerald-600' : RED.has(n) ? 'bg-red-700' : 'bg-neutral-900')
const OUTSIDE_BUTTONS = [
  { type: 'red', label: '레드' }, { type: 'black', label: '블랙' },
  { type: 'odd', label: '홀' }, { type: 'even', label: '짝' },
  { type: 'low', label: '1~18' }, { type: 'high', label: '19~36' },
  { type: 'dozen1', label: '1st 12' }, { type: 'dozen2', label: '2nd 12' }, { type: 'dozen3', label: '3rd 12' },
  { type: 'col1', label: '1열' }, { type: 'col2', label: '2열' }, { type: 'col3', label: '3열' },
]
const CHIPS = [100, 500, 1000, 5000]
const TYPE_LABELS = Object.fromEntries(OUTSIDE_BUTTONS.map((b) => [b.type, b.label]))

const myBets = computed(() => state.value?.bets.filter((b) => b.nickname === auth.user?.nickname) ?? [])

function startRolling() {
  sfx.spinStart()
  rollTimer = setInterval(() => {
    rolling.value = Math.floor(Math.random() * 37)
    sfx.spinTick()
  }, 90)
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'spinning' && state.value?.phase !== 'spinning') startRolling()
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      clearInterval(rollTimer)
      rolling.value = null
      if (myBets.value.length > 0) {
        // 내 베팅 중 하나라도 결과 번호에 적중했으면 승리음, 아니면 패배음
        const hit = myBets.value.some((b) => b.type === 'inside' && b.numbers?.includes(s.result))
        ;(hit ? sfx.win : sfx.lose)()
      }
    }
    state.value = s
  })
})
onUnmounted(() => {
  clearInterval(rollTimer)
  game.disconnect()
})

function toggleNumber(n) {
  sfx.click()
  const i = selected.value.indexOf(n)
  if (i >= 0) selected.value.splice(i, 1)
  else if (selected.value.length < 6) selected.value.push(n)
}

async function bet(payload) {
  error.value = ''
  sfx.chip()
  const res = await game.emitAck('bet:place', { ...payload, amount: amount.value })
  if (res.error) error.value = res.error
  else selected.value = []
}

function betInside() {
  if (![1, 2, 3, 4, 6].includes(selected.value.length)) {
    error.value = '번호를 1·2·3·4·6개 선택하세요.'
    return
  }
  bet({ type: 'inside', numbers: [...selected.value] })
}

const PHASE_LABELS = { waiting: '대기 중', betting: '베팅하세요!', spinning: '스핀!', result: '결과' }
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🎡 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 결과/휠 -->
    <section class="rounded-2xl border border-amber-500/20 bg-emerald-900/50 p-4 text-center">
      <div v-if="rolling !== null" class="text-4xl font-black text-amber-300 tabular-nums">{{ rolling }}</div>
      <div v-else-if="state.result !== null && state.phase === 'result'"
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-white"
        :class="colorClass(state.result)">{{ state.result }}</div>
      <div v-else class="text-sm text-emerald-400">베팅 후 결과를 기다리세요</div>
      <div class="mt-3 flex flex-wrap justify-center gap-1">
        <span v-for="(h, i) in state.history" :key="i"
          class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
          :class="colorClass(h.n)">{{ h.n }}</span>
      </div>
    </section>

    <!-- 번호판 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-3">
      <div class="grid grid-cols-13 gap-1" style="grid-template-columns: repeat(13, minmax(0, 1fr));">
        <button class="col-span-1 row-span-3 rounded font-bold text-white"
          :class="[colorClass(0), selected.includes(0) ? 'ring-2 ring-amber-400' : '']"
          style="grid-row: span 3;" @click="toggleNumber(0)">0</button>
        <template v-for="row in 3">
          <button v-for="col in 12" :key="`${row}-${col}`"
            class="aspect-square rounded text-xs font-bold text-white sm:text-sm"
            :class="[colorClass((col - 1) * 3 + (4 - row)), selected.includes((col - 1) * 3 + (4 - row)) ? 'ring-2 ring-amber-400' : '']"
            @click="toggleNumber((col - 1) * 3 + (4 - row))">
            {{ (col - 1) * 3 + (4 - row) }}
          </button>
        </template>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <button v-for="b in OUTSIDE_BUTTONS" :key="b.type"
          class="rounded bg-emerald-950 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-800"
          @click="bet({ type: b.type })">{{ b.label }}</button>
      </div>
    </section>

    <!-- 조작 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v"
          class="rounded-full border-2 px-3 py-2 text-xs font-bold"
          :class="amount === v ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-800'"
          @click="amount = v; sfx.click()">{{ v.toLocaleString() }}</button>
        <button :disabled="state.phase !== 'betting'"
          class="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
          @click="betInside">선택 번호에 베팅 ({{ selected.length }}개)</button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">
          {{ b.nickname }} — {{ b.type === 'inside' ? `번호 ${b.numbers.join(',')}` : TYPE_LABELS[b.type] }}
          · {{ b.amount.toLocaleString() }}칩
        </p>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 2: 라우트·로비·설정 그룹 연결**

`client/src/router/index.js` routes에 추가:
```js
  { path: '/roulette/:tableId', component: () => import('../views/RouletteView.vue'), meta: { requiresAuth: true } },
```
`client/src/views/LobbyView.vue` — games의 roulette 항목을 `tables: true`로 변경.
`client/src/views/admin/AdminSettingsView.vue` — GROUPS에 `{ key: 'roulette', label: '룰렛' }` 추가.

- [ ] **Step 3: 빌드 검증 및 Commit**

Run: `npm --prefix client run build` → 성공

```bash
git add client/src
git commit -m "feat: 룰렛 라이브 테이블 화면"
```

---

### Task 7: 클라 — 바카라 화면

**Files:**
- Create: `client/src/views/BaccaratView.vue`
- Modify: `client/src/router/index.js` (`/baccarat/:tableId`), `client/src/views/LobbyView.vue` (바카라 `tables: true`), `client/src/views/admin/AdminSettingsView.vue` (GROUPS에 바카라 추가)

**Interfaces:**
- Consumes: `useGameSocket('baccarat')`, `CardImg`, `PhaseTimer`, `useSound`, 스냅샷(Task 5)
- Produces: `/baccarat/:tableId` — 플레이어/뱅커 카드 영역(공개 시 순차 딜 사운드), 베팅 버튼 5종(배당 표기), 금액 칩, 전체 베팅 목록, 결과 배너(한국어), 히스토리 구슬(P=파랑, B=빨강, T=초록)

- [ ] **Step 1: 구현**

`client/src/views/BaccaratView.vue`:
```vue
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'
import PhaseTimer from '../components/PhaseTimer.vue'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('baccarat')

const state = ref(null)
const error = ref('')
const amount = ref(100)
const CHIPS = [100, 500, 1000, 5000]

const KIND_BUTTONS = computed(() => [
  { kind: 'ppair', label: 'P 페어', pay: `${state.value?.rules.pairPayout}:1`, cls: 'bg-sky-900' },
  { kind: 'player', label: '플레이어', pay: '1:1', cls: 'bg-sky-700' },
  { kind: 'tie', label: '타이', pay: `${state.value?.rules.tiePayout}:1`, cls: 'bg-emerald-700' },
  { kind: 'banker', label: '뱅커', pay: '0.95:1', cls: 'bg-red-700' },
  { kind: 'bpair', label: 'B 페어', pay: `${state.value?.rules.pairPayout}:1`, cls: 'bg-red-900' },
])
const OUTCOME_LABELS = { player: '플레이어 승!', banker: '뱅커 승!', tie: '타이!' }
const PHASE_LABELS = { waiting: '대기 중', betting: '베팅하세요!', revealing: '카드 공개', result: '결과' }
const BEAD = { player: 'bg-sky-500', banker: 'bg-red-500', tie: 'bg-emerald-500' }

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'revealing' && state.value?.phase !== 'revealing') sfx.deal()
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const mine = s.bets.some((b) => b.nickname === auth.user?.nickname)
      if (mine) sfx.win()
    }
    state.value = s
  })
})
onUnmounted(() => game.disconnect())

async function bet(kind) {
  error.value = ''
  sfx.chip()
  const res = await game.emitAck('bet:place', { kind, amount: amount.value })
  if (res.error) error.value = res.error
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🀄 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 카드 -->
    <section class="grid grid-cols-2 gap-3">
      <div class="rounded-2xl border border-sky-500/30 bg-emerald-900/50 p-4 text-center">
        <p class="text-xs font-bold text-sky-300">플레이어
          <b v-if="state.result" class="text-lg">{{ state.result.playerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.player ?? []" :key="i" :code="card.code" />
        </div>
      </div>
      <div class="rounded-2xl border border-red-500/30 bg-emerald-900/50 p-4 text-center">
        <p class="text-xs font-bold text-red-300">뱅커
          <b v-if="state.result" class="text-lg">{{ state.result.bankerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.banker ?? []" :key="i" :code="card.code" />
        </div>
      </div>
    </section>

    <p v-if="state.phase === 'result' && state.result" class="text-center text-xl font-black text-amber-400">
      {{ OUTCOME_LABELS[state.result.outcome] }}
      <span v-if="state.result.playerPair" class="ml-2 text-sm text-sky-300">P페어!</span>
      <span v-if="state.result.bankerPair" class="ml-2 text-sm text-red-300">B페어!</span>
    </p>

    <!-- 히스토리 -->
    <div class="flex flex-wrap gap-1">
      <span v-for="(h, i) in state.history" :key="i" class="h-4 w-4 rounded-full" :class="BEAD[h]" />
    </div>

    <!-- 베팅 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="grid grid-cols-5 gap-2">
        <button v-for="b in KIND_BUTTONS" :key="b.kind" :disabled="state.phase !== 'betting'"
          class="rounded-xl p-2 text-center text-white hover:opacity-80 disabled:opacity-40" :class="b.cls"
          @click="bet(b.kind)">
          <span class="block text-xs font-bold sm:text-sm">{{ b.label }}</span>
          <span class="block text-[10px] opacity-80">{{ b.pay }}</span>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v"
          class="rounded-full border-2 px-3 py-2 text-xs font-bold"
          :class="amount === v ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-800'"
          @click="amount = v; sfx.click()">{{ v.toLocaleString() }}</button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">{{ b.nickname }} — {{ b.kind }} · {{ b.amount.toLocaleString() }}칩</p>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 2: 라우트·로비·설정 그룹 연결**

`client/src/router/index.js` routes에 추가:
```js
  { path: '/baccarat/:tableId', component: () => import('../views/BaccaratView.vue'), meta: { requiresAuth: true } },
```
`client/src/views/LobbyView.vue` — baccarat 항목을 `tables: true`로 변경.
`client/src/views/admin/AdminSettingsView.vue` — GROUPS에 `{ key: 'baccarat', label: '바카라' }` 추가.

- [ ] **Step 3: 빌드 검증 및 Commit**

Run: `npm --prefix client run build` → 성공

```bash
git add client/src
git commit -m "feat: 바카라 라이브 테이블 화면"
```

---

### Task 8: 통합 검증 (실제 브라우저, 2개 창)

- [ ] **Step 1: 서버 테스트**

Run: `npm --prefix server test` → PASS (83 tests)

- [ ] **Step 2: 브라우저 시나리오**

1. admin: 룰렛·바카라 테이블 생성 → 로비에 즉시 표시
2. 룰렛 2창 동시 입장: 서로의 베팅이 실시간으로 목록에 보임. 인사이드(번호 3개 선택)·아웃사이드(레드) 베팅 → 스핀 연출 → 결과·정산·히스토리 갱신·잔액 확인
3. 바카라 2창: 플레이어/타이/페어 베팅 → 카드 공개 → 결과 배너·정산·히스토리 구슬 확인
4. admin: 룰렛 규칙에서 betSeconds를 10으로 저장 → 다음 라운드부터 타이머 10초
5. 라운드 진행 중 룰렛 테이블 닫기 → 알림·환불·로비 이동
6. 모바일 뷰(375px): 룰렛 번호판 터치 조작 가능, 바카라 5버튼 그리드 정상, 가로 스크롤 없음

Expected: 전 항목 통과

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: 플랜 5 완료 (룰렛·바카라 검증 통과)"
```
