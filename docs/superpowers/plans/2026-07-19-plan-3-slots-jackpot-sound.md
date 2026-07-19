# 플랜 3/7 — 슬롯머신 · 프로그레시브 잭팟 · 사운드 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 권위 슬롯머신(3릴), 전역 프로그레시브 잭팟(적립·당첨·실시간 브로드캐스트), 사운드 시스템(`jackpot-1.mp3` + Web Audio 합성 SE, 음소거 토글)을 완성한다.

**Architecture:** 슬롯은 REST(`POST /api/slots/spin`)로 충분하다(싱글플레이). 잭팟 풀은 DB 단일 행이며 `jackpotEvents`(wallet 패턴과 동일)로 소켓 브로드캐스트한다. 사운드는 `useSound` 컴포저블로 일원화 — 이후 플랜 4·5의 게임들도 이것만 import한다.

**Tech Stack:** 기존과 동일 (신규 서버 의존성 없음)

## Global Constraints

플랜 1·2의 Global Constraints 전체가 그대로 적용된다. 추가:

- 스핀 결과·배당은 100% 서버 계산. 클라이언트는 결과 연출만.
- 잭팟 사운드 파일 원본: `C:\Users\JinhoLap\Downloads\jackpot-1.mp3` → `client/public/sounds/jackpot.mp3`
- SE는 외부 파일 없이 Web Audio API 합성. 음소거 상태는 localStorage `muted`에 유지.
- 난수는 `rng` 파라미터 주입 가능하게 (테스트 결정성).

## 물려받는 인터페이스 (변경 금지)

- `applyTransaction`, `getSettings`/`saveSettings`(`DEFAULT_SETTINGS`에 키 추가는 이 플랜에서 함), `requireAuth`, `createApp(db, ctx)`, `walletEvents`
- 클라: `api`, `useAuthStore.setBalance`, `connectSocket`/`getSocket`, `onNotice` 패턴(리스너 레지스트리)

---

### Task 1: 잭팟 서비스

**Files:**
- Create: `server/src/services/jackpot.js`
- Modify: `server/src/services/settings.js` (DEFAULT_SETTINGS에 `slots` 추가)
- Test: `server/test/jackpot.test.js`

**Interfaces:**
- Consumes: `createDb`, `applyTransaction`
- Produces:
  - `DEFAULT_SETTINGS.slots = { minBet: 100, maxBet: 5000, betStep: 100, jackpotRate: 0.01, jackpotSeed: 50000 }`
  - `ensureJackpot(db, seed) → row` — jackpot 행(id=1)이 없으면 `{pool: seed, seed}` 생성
  - `getJackpot(db) → { pool, seed, last_winner_id, last_won_amount, last_won_at }`
  - `contributeJackpot(db, betAmount, rate) → pool` — `Math.floor(betAmount * rate)` 적립(0이면 무변화), 새 pool 반환 + `jackpotEvents.emit('pool', { pool })`
  - `winJackpot(db, userId) → amount` — 원자적으로: pool 전액을 `applyTransaction(type:'jackpot')`으로 지급, pool을 seed로 리셋, last_* 기록, `jackpotEvents.emit('pool', ...)` + `jackpotEvents.emit('won', { userId, nickname, amount })`
  - `jackpotEvents: EventEmitter`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/jackpot.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { ensureJackpot, getJackpot, contributeJackpot, winJackpot, jackpotEvents } from '../src/services/jackpot.js'

describe('jackpot', () => {
  let db
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('j1', 'h', '잭팟러', 0)").run()
    ensureJackpot(db, 50000)
  })

  it('초기 풀은 시드와 같다', () => {
    expect(getJackpot(db).pool).toBe(50000)
  })

  it('적립은 베팅액×비율의 내림값이며 pool 이벤트가 나간다', () => {
    let ev = null
    jackpotEvents.once('pool', (p) => (ev = p))
    const pool = contributeJackpot(db, 1000, 0.01)
    expect(pool).toBe(50010)
    expect(ev.pool).toBe(50010)
  })

  it('당첨 시 전액 지급되고 풀이 시드로 리셋된다', () => {
    contributeJackpot(db, 10000, 0.01)
    let won = null
    jackpotEvents.once('won', (p) => (won = p))
    const amount = winJackpot(db, 1)
    expect(amount).toBe(50100)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(50100)
    expect(getJackpot(db).pool).toBe(50000)
    expect(getJackpot(db).last_winner_id).toBe(1)
    expect(won.nickname).toBe('잭팟러')
    expect(won.amount).toBe(50100)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — jackpot.js 없음

- [ ] **Step 3: 구현**

`server/src/services/settings.js`의 `DEFAULT_SETTINGS`에 추가:
```js
  slots: {
    minBet: 100,
    maxBet: 5000,
    betStep: 100,
    jackpotRate: 0.01,
    jackpotSeed: 50000,
  },
```

`server/src/services/jackpot.js`:
```js
import { EventEmitter } from 'node:events'
import { applyTransaction } from './wallet.js'

export const jackpotEvents = new EventEmitter()
jackpotEvents.setMaxListeners(0)

export function ensureJackpot(db, seed) {
  db.prepare('INSERT OR IGNORE INTO jackpot (id, pool, seed) VALUES (1, ?, ?)').run(seed, seed)
  return getJackpot(db)
}

export function getJackpot(db) {
  return db.prepare('SELECT * FROM jackpot WHERE id = 1').get()
}

export function contributeJackpot(db, betAmount, rate) {
  const add = Math.floor(betAmount * rate)
  if (add > 0) db.prepare('UPDATE jackpot SET pool = pool + ? WHERE id = 1').run(add)
  const { pool } = getJackpot(db)
  if (add > 0) jackpotEvents.emit('pool', { pool })
  return pool
}

export function winJackpot(db, userId) {
  const amount = db.transaction(() => {
    const { pool, seed } = getJackpot(db)
    db.prepare(
      "UPDATE jackpot SET pool = seed, last_winner_id = ?, last_won_amount = ?, last_won_at = datetime('now') WHERE id = 1"
    ).run(userId, pool)
    applyTransaction(db, { userId, type: 'jackpot', amount: pool, game: 'slots', reason: '프로그레시브 잭팟 당첨' })
    return pool
  })()
  const { nickname } = db.prepare('SELECT nickname FROM users WHERE id = ?').get(userId)
  jackpotEvents.emit('pool', { pool: getJackpot(db).pool })
  jackpotEvents.emit('won', { userId, nickname, amount })
  return amount
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 33 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/jackpot.test.js
git commit -m "feat: 전역 프로그레시브 잭팟 서비스"
```

---

### Task 2: 슬롯 엔진 (릴 · 배당표 · 스핀)

**Files:**
- Create: `server/src/games/slots/engine.js`
- Test: `server/test/slots-engine.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7']`
  - `REEL` — 심볼 가중 배열 1개(3릴 공용): 🍒×8, 🍋×6, 🔔×4, ⭐×2, 7×1 (총 21칸)
  - `PAYTABLE` — `[{ match: '7,7,7', label: '잭팟! + 50배', multiplier: 50, jackpot: true }, { match: '⭐,⭐,⭐', multiplier: 25 }, { match: '🔔,🔔,🔔', multiplier: 10 }, { match: '🍋,🍋,🍋', multiplier: 5 }, { match: '🍒,🍒,🍒', multiplier: 3 }, { match: '🍒,🍒,*', multiplier: 1 }]` (🍒 2개는 앞 2릴 기준)
  - `spin(rng = Math.random) → [s1, s2, s3]` — 릴마다 `REEL[Math.floor(rng() * REEL.length)]`
  - `evaluate(symbols, bet) → { multiplier, payout, isJackpot, label }` — payout = bet × multiplier (잭팟 풀 지급은 별도)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/slots-engine.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { spin, evaluate, REEL } from '../src/games/slots/engine.js'

function rngFor(indexes) {
  let i = 0
  return () => indexes[i++] / REEL.length
}

describe('slots engine', () => {
  it('rng 주입으로 결과가 결정적이다', () => {
    const idx7 = REEL.indexOf('7')
    const symbols = spin(rngFor([idx7, idx7, idx7]))
    expect(symbols).toEqual(['7', '7', '7'])
  })

  it('7 3개는 잭팟 + 50배', () => {
    const r = evaluate(['7', '7', '7'], 100)
    expect(r.isJackpot).toBe(true)
    expect(r.payout).toBe(5000)
  })

  it('체리 2개(앞 2릴)는 1배', () => {
    expect(evaluate(['🍒', '🍒', '🔔'], 200).payout).toBe(200)
  })

  it('체리 3개는 3배 (2개 규칙에 우선)', () => {
    expect(evaluate(['🍒', '🍒', '🍒'], 100).payout).toBe(300)
  })

  it('무일치는 0', () => {
    const r = evaluate(['🍒', '🔔', '⭐'], 100)
    expect(r.payout).toBe(0)
    expect(r.isJackpot).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — engine.js 없음

- [ ] **Step 3: 구현**

`server/src/games/slots/engine.js`:
```js
export const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7']

export const REEL = [
  ...Array(8).fill('🍒'),
  ...Array(6).fill('🍋'),
  ...Array(4).fill('🔔'),
  ...Array(2).fill('⭐'),
  '7',
]

export const PAYTABLE = [
  { match: ['7', '7', '7'], label: '잭팟! + 50배', multiplier: 50, jackpot: true },
  { match: ['⭐', '⭐', '⭐'], label: '별 3개 25배', multiplier: 25 },
  { match: ['🔔', '🔔', '🔔'], label: '종 3개 10배', multiplier: 10 },
  { match: ['🍋', '🍋', '🍋'], label: '레몬 3개 5배', multiplier: 5 },
  { match: ['🍒', '🍒', '🍒'], label: '체리 3개 3배', multiplier: 3 },
  { match: ['🍒', '🍒', '*'], label: '체리 2개 1배', multiplier: 1 },
]

export function spin(rng = Math.random) {
  return [0, 1, 2].map(() => REEL[Math.floor(rng() * REEL.length)])
}

export function evaluate(symbols, bet) {
  for (const row of PAYTABLE) {
    const hit = row.match.every((m, i) => m === '*' || m === symbols[i])
    if (hit) {
      return { multiplier: row.multiplier, payout: bet * row.multiplier, isJackpot: !!row.jackpot, label: row.label }
    }
  }
  return { multiplier: 0, payout: 0, isJackpot: false, label: null }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 38 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/games server/test/slots-engine.test.js
git commit -m "feat: 슬롯 엔진 (가중 릴·배당표·결정적 rng)"
```

---

### Task 3: 슬롯 API + 잭팟 소켓 브로드캐스트

**Files:**
- Create: `server/src/routes/slots.js`
- Modify: `server/src/app.js` (마운트), `server/src/sockets/index.js` (jackpotEvents 구독), `server/src/index.js` (`ensureJackpot` 호출)
- Test: `server/test/slots-api.test.js`

**Interfaces:**
- Consumes: `applyTransaction`, `getSettings(db,'slots')`, jackpot 서비스, slots 엔진
- Produces:
  - `GET /api/slots/state` → `{ settings: { minBet, maxBet, betStep }, pool, paytable: [{ match, label, multiplier }] }`
  - `POST /api/slots/spin { bet }` → `{ symbols, payout, multiplier, label, jackpotWon, jackpotAmount, balance, pool }`
    - 검증: 정수, minBet ≤ bet ≤ maxBet, betStep 배수. 잔액 부족 시 400 `{ error: '칩이 부족합니다.' }`
    - 순서: bet 차감 → contribute → spin → payout 지급(>0일 때) → 잭팟이면 winJackpot → rounds/bets 기록
    - `slotsRouter(db, { rng } = {})` — 테스트에서 rng 주입
  - 소켓: `jackpot:pool { pool }` 전체 브로드캐스트, `jackpot:won { nickname, amount }` 전체 브로드캐스트
  - `index.js` 기동 시 `ensureJackpot(db, getSettings(db,'slots').jackpotSeed)`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/slots-api.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { slotsRouter } from '../src/routes/slots.js'
import { ensureJackpot } from '../src/services/jackpot.js'
import { REEL } from '../src/games/slots/engine.js'

function appWithRng(db, indexes) {
  let i = 0
  const rng = () => indexes[i++ % indexes.length] / REEL.length
  const app = createApp(db, {})
  const test = express()
  test.use(express.json())
  test.use('/api/slots', slotsRouter(db, { rng }))
  test.use(app)
  return test
}

describe('slots api', () => {
  let db, token
  const idx7 = REEL.indexOf('7')
  const idxCherry = REEL.indexOf('🍒')
  const idxBell = REEL.indexOf('🔔')
  const idxStar = REEL.indexOf('⭐')

  beforeEach(async () => {
    db = createDb()
    ensureJackpot(db, 50000)
  })

  async function signup(app) {
    const res = await request(app).post('/api/auth/signup')
      .send({ username: 'spinner1', password: 'password1', nickname: '스피너', agreed: true })
    token = res.body.token
  }

  it('state는 설정·풀·배당표를 준다', async () => {
    const app = appWithRng(db, [0])
    await signup(app)
    const res = await request(app).get('/api/slots/state').set('Authorization', `Bearer ${token}`)
    expect(res.body.pool).toBe(50000)
    expect(res.body.settings.minBet).toBe(100)
    expect(res.body.paytable.length).toBeGreaterThan(0)
  })

  it('꽝 스핀: 베팅 차감 + 잭팟 적립', async () => {
    const app = appWithRng(db, [idxCherry, idxBell, idxStar])
    await signup(app)
    const res = await request(app).post('/api/slots/spin')
      .set('Authorization', `Bearer ${token}`).send({ bet: 1000 })
    expect(res.status).toBe(200)
    expect(res.body.payout).toBe(0)
    expect(res.body.balance).toBe(9000)
    expect(res.body.pool).toBe(50010)
  })

  it('잭팟 스핀: 50배 + 풀 전액 지급, 풀 리셋', async () => {
    const app = appWithRng(db, [idx7, idx7, idx7])
    await signup(app)
    const res = await request(app).post('/api/slots/spin')
      .set('Authorization', `Bearer ${token}`).send({ bet: 100 })
    expect(res.body.jackpotWon).toBe(true)
    expect(res.body.jackpotAmount).toBe(50001)
    expect(res.body.balance).toBe(10000 - 100 + 5000 + 50001)
    expect(res.body.pool).toBe(50000)
  })

  it('베팅 검증: 단위·한도 위반은 400', async () => {
    const app = appWithRng(db, [0])
    await signup(app)
    for (const bet of [50, 150, 999999, -100, 'abc']) {
      const res = await request(app).post('/api/slots/spin')
        .set('Authorization', `Bearer ${token}`).send({ bet })
      expect(res.status).toBe(400)
    }
  })

  it('round와 bet이 기록된다', async () => {
    const app = appWithRng(db, [idxCherry, idxBell, idxStar])
    await signup(app)
    await request(app).post('/api/slots/spin').set('Authorization', `Bearer ${token}`).send({ bet: 100 })
    expect(db.prepare("SELECT COUNT(*) c FROM rounds WHERE game = 'slots'").get().c).toBe(1)
    expect(db.prepare('SELECT amount, payout FROM bets').get()).toEqual({ amount: 100, payout: 0 })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — slots.js 없음

- [ ] **Step 3: 구현**

`server/src/routes/slots.js`:
```js
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { applyTransaction, InsufficientBalanceError } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { getJackpot, contributeJackpot, winJackpot } from '../services/jackpot.js'
import { spin, evaluate, PAYTABLE } from '../games/slots/engine.js'

export function slotsRouter(db, { rng = Math.random } = {}) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/state', (req, res) => {
    const s = getSettings(db, 'slots')
    res.json({
      settings: { minBet: s.minBet, maxBet: s.maxBet, betStep: s.betStep },
      pool: getJackpot(db).pool,
      paytable: PAYTABLE.map(({ match, label, multiplier }) => ({ match, label, multiplier })),
    })
  })

  r.post('/spin', (req, res) => {
    const s = getSettings(db, 'slots')
    const bet = req.body?.bet
    if (!Number.isInteger(bet) || bet < s.minBet || bet > s.maxBet || bet % s.betStep !== 0) {
      return res.status(400).json({ error: `베팅은 ${s.minBet}~${s.maxBet}칩, ${s.betStep}칩 단위여야 합니다.` })
    }

    const { lastInsertRowid: roundId } = db.prepare("INSERT INTO rounds (game) VALUES ('slots')").run()
    let balance
    try {
      balance = applyTransaction(db, {
        userId: req.user.id, type: 'bet', amount: -bet, game: 'slots', refRoundId: roundId,
      }).balanceAfter
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return res.status(400).json({ error: e.message })
      throw e
    }

    contributeJackpot(db, bet, s.jackpotRate)
    const symbols = spin(rng)
    const result = evaluate(symbols, bet)

    if (result.payout > 0) {
      balance = applyTransaction(db, {
        userId: req.user.id, type: 'payout', amount: result.payout, game: 'slots', refRoundId: roundId,
      }).balanceAfter
    }

    let jackpotAmount = 0
    if (result.isJackpot) {
      jackpotAmount = winJackpot(db, req.user.id)
      balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id).balance
    }

    db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ symbols, ...result, jackpotAmount }), roundId)
    db.prepare('INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)')
      .run(roundId, req.user.id, JSON.stringify({ bet }), bet, result.payout + jackpotAmount)

    res.json({
      symbols,
      payout: result.payout,
      multiplier: result.multiplier,
      label: result.label,
      jackpotWon: result.isJackpot,
      jackpotAmount,
      balance,
      pool: getJackpot(db).pool,
    })
  })

  return r
}
```

`server/src/app.js` 마운트 추가:
```js
import { slotsRouter } from './routes/slots.js'
// ...
app.use('/api/slots', slotsRouter(db))
```

`server/src/sockets/index.js` — import 추가 후 `walletEvents.on(...)` 아래에:
```js
import { jackpotEvents } from '../services/jackpot.js'
// createSocketServer 안:
  jackpotEvents.on('pool', ({ pool }) => io.emit('jackpot:pool', { pool }))
  jackpotEvents.on('won', ({ nickname, amount }) => io.emit('jackpot:won', { nickname, amount }))
```

`server/src/index.js` — `ensureAdmin(db)` 아래에:
```js
import { ensureJackpot } from './services/jackpot.js'
import { getSettings } from './services/settings.js'
// ...
ensureJackpot(db, getSettings(db, 'slots').jackpotSeed)
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 43 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/slots-api.test.js
git commit -m "feat: 슬롯 스핀 API + 잭팟 적립·당첨 브로드캐스트"
```

---

### Task 4: 사운드 시스템 (mp3 복사 + Web Audio SE + 음소거)

**Files:**
- Create: `client/public/sounds/jackpot.mp3` (복사), `client/src/composables/useSound.js`
- Modify: `client/src/App.vue` (음소거 토글 버튼)

**Interfaces:**
- Consumes: 없음
- Produces (`useSound()` 반환 — 이후 모든 게임 뷰가 사용):
  - `muted: Ref<boolean>` / `toggleMute()` — localStorage `muted` 유지
  - `sfx.click()` 버튼 조작음 / `sfx.chip()` 칩 베팅음 / `sfx.deal()` 카드 딜음 / `sfx.spinStart()`·`sfx.spinTick()` 릴·휠 회전음 / `sfx.win()` 승리 팡파르 / `sfx.lose()` 패배음 / `sfx.countdown()` 카운트다운 경고음
  - `playJackpot()` — `/sounds/jackpot.mp3` 재생 (HTMLAudio)
  - 모든 재생 함수는 muted면 no-op. AudioContext는 첫 호출 때 lazy 생성(브라우저 자동재생 정책 대응).

- [ ] **Step 1: mp3 복사 (PowerShell)**

Run:
```powershell
New-Item -ItemType Directory -Force client/public/sounds
Copy-Item "C:\Users\JinhoLap\Downloads\jackpot-1.mp3" client/public/sounds/jackpot.mp3
```
Expected: `client/public/sounds/jackpot.mp3` 존재

- [ ] **Step 2: useSound 구현**

`client/src/composables/useSound.js`:
```js
import { ref } from 'vue'

const muted = ref(localStorage.getItem('muted') === '1')
let audioCtx = null

function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function tone({ freq = 440, duration = 0.1, type = 'sine', volume = 0.15, when = 0, slideTo = null }) {
  if (muted.value) return
  const c = ctx()
  const osc = c.createOscillator()
  const gain = c.createGain()
  const t0 = c.currentTime + when
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration)
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

function noise({ duration = 0.06, volume = 0.1, when = 0 }) {
  if (muted.value) return
  const c = ctx()
  const buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  const gain = c.createGain()
  const t0 = c.currentTime + when
  src.buffer = buffer
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  src.connect(gain).connect(c.destination)
  src.start(t0)
}

export const sfx = {
  click: () => tone({ freq: 700, duration: 0.05, type: 'square', volume: 0.06 }),
  chip: () => {
    tone({ freq: 1800, duration: 0.04, type: 'triangle', volume: 0.12 })
    tone({ freq: 2400, duration: 0.05, type: 'triangle', volume: 0.08, when: 0.05 })
  },
  deal: () => noise({ duration: 0.08, volume: 0.12 }),
  spinStart: () => tone({ freq: 200, duration: 0.3, type: 'sawtooth', volume: 0.08, slideTo: 600 }),
  spinTick: () => tone({ freq: 900, duration: 0.03, type: 'square', volume: 0.05 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.15, type: 'triangle', volume: 0.14, when: i * 0.12 }))
  },
  lose: () => {
    tone({ freq: 330, duration: 0.2, type: 'sine', volume: 0.1 })
    tone({ freq: 220, duration: 0.35, type: 'sine', volume: 0.1, when: 0.18 })
  },
  countdown: () => tone({ freq: 1000, duration: 0.08, type: 'sine', volume: 0.1 }),
}

let jackpotAudio = null
export function playJackpot() {
  if (muted.value) return
  if (!jackpotAudio) jackpotAudio = new Audio('/sounds/jackpot.mp3')
  jackpotAudio.currentTime = 0
  jackpotAudio.play().catch(() => {})
}

export function useSound() {
  function toggleMute() {
    muted.value = !muted.value
    localStorage.setItem('muted', muted.value ? '1' : '0')
  }
  return { muted, toggleMute, sfx, playJackpot }
}
```

- [ ] **Step 3: 헤더에 음소거 토글**

`client/src/App.vue` — `<script setup>`에 `import { useSound } from './composables/useSound'`와 `const { muted, toggleMute } = useSound()` 추가. 헤더의 로그아웃 버튼 앞에:
```html
        <button class="text-lg" :title="muted ? '소리 켜기' : '소리 끄기'" @click="toggleMute">
          {{ muted ? '🔇' : '🔊' }}
        </button>
```

- [ ] **Step 4: 빌드 검증 및 Commit**

Run: `npm --prefix client run build`
Expected: 성공

```bash
git add client
git commit -m "feat: 사운드 시스템 (잭팟 mp3 + Web Audio SE + 음소거)"
```

---

### Task 5: 클라 — 슬롯머신 화면 + 전역 잭팟 위젯/배너

**Files:**
- Create: `client/src/views/SlotsView.vue`, `client/src/components/JackpotWidget.vue`, `client/src/components/JackpotBanner.vue`
- Modify: `client/src/router/index.js` (`/slots` 라우트), `client/src/views/LobbyView.vue` (슬롯 카드 활성화 + 위젯 교체), `client/src/App.vue` (배너 전역 표시), `client/src/composables/useSocket.js` (잭팟 리스너)

**Interfaces:**
- Consumes: `GET /api/slots/state`, `POST /api/slots/spin`, 소켓 `jackpot:pool`/`jackpot:won`, `useSound`
- Produces:
  - `useSocket.js`에 `onJackpotPool(fn)`, `onJackpotWon(fn)` 리스너 레지스트리 (onNotice와 동일 패턴 — connectSocket에서 `socket.on('jackpot:pool', ...)`, `socket.on('jackpot:won', ...)` 등록)
  - `JackpotWidget` — 현재 풀 금액 실시간 표시 (로비)
  - `JackpotBanner` — `jackpot:won` 수신 시 화면 상단에 8초간 "🎉 {nickname}님이 잭팟 {amount}칩 당첨!" 배너 (App.vue 전역)
  - `SlotsView` — 3릴 스핀 애니메이션(CSS), 베팅 조절(±betStep), 스핀 버튼, 배당표, 결과 표시. 스핀 중 재스핀 금지. **본인 잭팟 당첨 시 `playJackpot()`** + 당첨 연출, 일반 승리는 `sfx.win()`, 꽝은 `sfx.lose()`

- [ ] **Step 1: useSocket 리스너 추가**

`client/src/composables/useSocket.js`에 추가 (onNotice 패턴과 동일):
```js
const jackpotPoolListeners = new Set()
const jackpotWonListeners = new Set()
export function onJackpotPool(fn) {
  jackpotPoolListeners.add(fn)
  return () => jackpotPoolListeners.delete(fn)
}
export function onJackpotWon(fn) {
  jackpotWonListeners.add(fn)
  return () => jackpotWonListeners.delete(fn)
}
```
`connectSocket` 내부, notice 리스너 아래에:
```js
  socket.on('jackpot:pool', (p) => jackpotPoolListeners.forEach((fn) => fn(p)))
  socket.on('jackpot:won', (p) => jackpotWonListeners.forEach((fn) => fn(p)))
```

- [ ] **Step 2: 위젯·배너 구현**

`client/src/components/JackpotWidget.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { onJackpotPool } from '../composables/useSocket'

const pool = ref(0)
let off
onMounted(async () => {
  pool.value = (await api('/slots/state')).pool
  off = onJackpotPool(({ pool: p }) => (pool.value = p))
})
onUnmounted(() => off?.())
</script>

<template>
  <section class="rounded-xl border border-amber-500/40 bg-gradient-to-r from-emerald-900 to-emerald-950 p-4 text-center">
    <p class="text-xs text-amber-300">💎 프로그레시브 잭팟</p>
    <p class="mt-1 text-3xl font-black tabular-nums text-amber-400">{{ pool.toLocaleString() }} 칩</p>
    <p class="mt-1 text-xs text-emerald-400">슬롯 스핀마다 쌓입니다. 7-7-7이면 전액 당첨!</p>
  </section>
</template>
```

`client/src/components/JackpotBanner.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { onJackpotWon } from '../composables/useSocket'

const banner = ref(null)
let off, timer
onMounted(() => {
  off = onJackpotWon((p) => {
    banner.value = p
    clearTimeout(timer)
    timer = setTimeout(() => (banner.value = null), 8000)
  })
})
onUnmounted(() => {
  off?.()
  clearTimeout(timer)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="banner"
      class="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-5 py-2 text-sm font-bold text-emerald-950 shadow-xl">
      🎉 {{ banner.nickname }}님이 잭팟 {{ banner.amount.toLocaleString() }}칩 당첨!
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

`client/src/App.vue` — 템플릿 최상단 div 바로 안에 `<JackpotBanner />` 추가, import 추가.

- [ ] **Step 3: SlotsView 구현**

`client/src/views/SlotsView.vue`:
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'
import { connectSocket } from '../composables/useSocket'

const auth = useAuthStore()
const { sfx, playJackpot } = useSound()

const state = ref(null)
const bet = ref(0)
const reels = ref(['❔', '❔', '❔'])
const spinning = ref(false)
const result = ref(null)
const error = ref('')

onMounted(async () => {
  connectSocket()
  state.value = await api('/slots/state')
  bet.value = state.value.settings.minBet
})

function adjust(delta) {
  sfx.click()
  const { minBet, maxBet, betStep } = state.value.settings
  bet.value = Math.min(maxBet, Math.max(minBet, bet.value + delta * betStep))
}

async function doSpin() {
  if (spinning.value) return
  error.value = ''
  result.value = null
  spinning.value = true
  sfx.spinStart()
  const ticker = setInterval(() => {
    reels.value = reels.value.map(() => ['🍒', '🍋', '🔔', '⭐', '7'][Math.floor(Math.random() * 5)])
    sfx.spinTick()
  }, 80)
  try {
    const res = await api('/slots/spin', { method: 'POST', body: { bet: bet.value } })
    setTimeout(() => {
      clearInterval(ticker)
      reels.value = res.symbols
      result.value = res
      auth.setBalance(res.balance)
      if (res.jackpotWon) playJackpot()
      else if (res.payout > 0) sfx.win()
      else sfx.lose()
      spinning.value = false
    }, 1200)
  } catch (e) {
    clearInterval(ticker)
    error.value = e.message
    spinning.value = false
  }
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-lg space-y-4">
    <h1 class="text-xl font-bold text-amber-400">🎰 슬롯머신</h1>

    <div class="rounded-2xl border-4 border-amber-500/60 bg-emerald-900 p-6">
      <div class="flex justify-center gap-3">
        <div v-for="(s, i) in reels" :key="i"
          class="flex h-24 w-20 items-center justify-center rounded-xl bg-emerald-950 text-5xl shadow-inner sm:h-28 sm:w-24">
          {{ s }}
        </div>
      </div>

      <div v-if="result" class="mt-4 text-center">
        <p v-if="result.jackpotWon" class="animate-bounce text-xl font-black text-amber-400">
          💎 잭팟! {{ result.jackpotAmount.toLocaleString() }}칩 당첨!
        </p>
        <p v-else-if="result.payout > 0" class="text-lg font-bold text-amber-300">
          {{ result.label }} — +{{ result.payout.toLocaleString() }}칩
        </p>
        <p v-else class="text-emerald-400">아쉽네요! 다음 기회에…</p>
      </div>

      <div class="mt-5 flex items-center justify-center gap-2">
        <button class="h-10 w-10 rounded-lg bg-emerald-800 text-lg hover:bg-emerald-700" @click="adjust(-1)">−</button>
        <span class="w-28 text-center font-bold tabular-nums">{{ bet.toLocaleString() }} 칩</span>
        <button class="h-10 w-10 rounded-lg bg-emerald-800 text-lg hover:bg-emerald-700" @click="adjust(1)">＋</button>
      </div>
      <button :disabled="spinning"
        class="mt-3 w-full rounded-xl bg-amber-500 py-3 text-lg font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-50"
        @click="doSpin">
        {{ spinning ? '스핀 중…' : 'SPIN' }}
      </button>
      <p v-if="error" class="mt-2 text-center text-sm text-red-400">{{ error }}</p>
    </div>

    <details class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm">
      <summary class="cursor-pointer font-bold text-amber-300">배당표</summary>
      <ul class="mt-2 space-y-1 text-emerald-200">
        <li v-for="p in state.paytable" :key="p.label" class="flex justify-between">
          <span>{{ p.match.join(' ') }}</span><span>{{ p.label }}</span>
        </li>
      </ul>
    </details>
  </div>
</template>
```

- [ ] **Step 4: 라우트·로비 연결**

`client/src/router/index.js` routes에 추가:
```js
  { path: '/slots', component: () => import('../views/SlotsView.vue'), meta: { requiresAuth: true } },
```

`client/src/views/LobbyView.vue`:
- 잭팟 플레이스홀더 섹션을 `<JackpotWidget />`로 교체 (import 추가)
- 게임 카드에서 슬롯만 활성화: games 배열에 `to: '/slots'` 추가하고, 템플릿의 카드 div를 `<component :is="g.to ? 'RouterLink' : 'div'" :to="g.to" ...>`로 변경, `준비 중` 배지는 `v-if="!g.to"`로.

- [ ] **Step 5: 빌드 검증 및 Commit**

Run: `npm --prefix client run build`
Expected: 성공

```bash
git add client/src
git commit -m "feat: 슬롯머신 화면·잭팟 위젯·전역 당첨 배너"
```

---

### Task 6: 통합 검증 (실제 브라우저, 2개 창)

- [ ] **Step 1: 서버 테스트**

Run: `npm --prefix server test`
Expected: PASS (43 tests)

- [ ] **Step 2: 브라우저 시나리오**

1. 로비 → 슬롯 카드 클릭 → 슬롯 화면. 베팅 ± 버튼이 한도·단위를 지키는지
2. 스핀 → 릴 애니메이션 + 효과음 → 결과 표시, 잔액 즉시 갱신, 로비 잭팟 위젯 금액이 두 창 모두에서 실시간 증가
3. 음소거 토글 → 모든 소리 정지, 새로고침 후에도 유지
4. 잭팟 검증 (강제): 서버 중지 후 `node -e` 대신 **admin으로 slots 설정을 바꿀 수 없으므로**, 임시로 `server/src/routes/slots.js`의 rng를 `() => REEL.indexOf('7') / REEL.length`로 바꿔 기동 → 스핀 → 당첨자 창에서 `jackpot.mp3` 재생 + 다른 창에 배너 표시 + 위젯 리셋 확인 → **rng 원복 후 재기동** (원복 커밋 diff 없음 확인: `git status`)
5. 잔액을 소진해 잔액 부족 스핀 → 한국어 에러 표시
6. 모바일 뷰(375px): 릴·버튼 조작 가능, 가로 스크롤 없음

Expected: 전 항목 통과

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: 플랜 3 완료 (슬롯·잭팟·사운드 검증 통과)"
```
