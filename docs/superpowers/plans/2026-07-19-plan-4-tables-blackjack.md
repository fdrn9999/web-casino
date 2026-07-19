# 플랜 4/7 — 테이블 CRUD · 라운드 루프 프레임워크 · 블랙잭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 테이블 CRUD, 서버 주도 라운드 루프 프레임워크(플랜 5의 룰렛·바카라가 재사용), 카드 에셋 도입, 실시간 멀티플레이어 블랙잭(7석, 규칙 설정 반영), 관리자 규칙 설정 화면을 완성한다.

**Architecture:** 게임별 Socket.IO 네임스페이스(`/blackjack`)와 테이블별 room(`table:{id}`)을 쓴다. 열린 테이블마다 서버에 Runner 인스턴스가 떠서 상태 머신을 순환한다(타이머 주입 가능 → 테스트 용이). Runner는 소켓과 분리된 순수 메서드(`sit/leave/placeBet/action`)를 노출하고, 소켓 계층은 이를 호출만 한다. 로비 테이블 목록은 `tables:update` 브로드캐스트로 실시간 동기화.

**Tech Stack:** 기존과 동일 + [playing-cards-assets](https://github.com/hayeah/playing-cards-assets) SVG(MIT)

## Global Constraints

플랜 1~3의 Global Constraints 전체 적용. 추가:

- 게임 결과·카드·타이머는 100% 서버 결정. 클라는 스냅샷(`table:state`) 렌더만.
- 베팅은 `bet:place` 시점에 즉시 차감, 정산·환불만 지급. 서버 중단/테이블 닫기 시 미정산 베팅 전액 환불.
- 규칙(`getSettings(db,'blackjack')`)은 **라운드 시작 시점에 읽는다** → 변경은 다음 라운드부터 적용.
- 테이블 `limits_json`은 `{minBet, maxBet}`만 오버라이드 가능. 나머지 규칙은 전역.
- 스냅샷의 타이머는 `phaseEndsAt`(epoch ms)로 내려주고 클라가 카운트다운 렌더.
- 카드 에셋 출처(MIT) 고지를 `client/src/assets/cards/LICENSE`로 유지.

## 물려받는 인터페이스 (변경 금지)

- `applyTransaction`, `InsufficientBalanceError`, `walletEvents`, `getSettings`/`saveSettings`/`DEFAULT_SETTINGS`, `requireAuth`/`requireAdmin`/`verifyToken`, `createApp(db, ctx)`, `disconnectUser`
- 클라: `api`, `useAuthStore`, `connectSocket`/`getSocket`/`onNotice`/`onJackpotPool`/`onJackpotWon`, `useSound`의 `sfx.*`

---

### Task 1: 카드 · 슈 모듈

**Files:**
- Create: `server/src/games/cards.js`
- Test: `server/test/cards.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `SUITS = ['S','H','D','C']`, `RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']`
  - 카드 형태: `{ rank, suit, code }` — `code`는 `rank + suit` (예: `'AS'`, `'10D'`)
  - `buildShoe(deckCount, rng = Math.random) → card[]` — deckCount×52장을 Fisher–Yates 셔플
  - `drawCard(shoe) → card` — `shoe.pop()`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/cards.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { buildShoe, drawCard, RANKS, SUITS } from '../src/games/cards.js'

describe('cards', () => {
  it('슈는 덱수×52장이고 각 카드가 덱수만큼 있다', () => {
    const shoe = buildShoe(6)
    expect(shoe.length).toBe(312)
    const asCount = shoe.filter((c) => c.code === 'AS').length
    expect(asCount).toBe(6)
  })

  it('rng 주입 시 셔플이 결정적이다', () => {
    const rng = () => 0.5
    const a = buildShoe(1, rng).map((c) => c.code)
    const b = buildShoe(1, rng).map((c) => c.code)
    expect(a).toEqual(b)
  })

  it('drawCard는 마지막 카드를 꺼낸다', () => {
    const shoe = buildShoe(1)
    const before = shoe.length
    const card = drawCard(shoe)
    expect(shoe.length).toBe(before - 1)
    expect(RANKS).toContain(card.rank)
    expect(SUITS).toContain(card.suit)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL

- [ ] **Step 3: 구현**

`server/src/games/cards.js`:
```js
export const SUITS = ['S', 'H', 'D', 'C']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function buildShoe(deckCount, rng = Math.random) {
  const shoe = []
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, code: rank + suit })
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

export function drawCard(shoe) {
  return shoe.pop()
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 46 tests)

```bash
git add server/src/games/cards.js server/test/cards.test.js
git commit -m "feat: 카드·슈 모듈"
```

---

### Task 2: 블랙잭 엔진 (핸드 평가 · 딜러 규칙 · 정산)

**Files:**
- Create: `server/src/games/blackjack/engine.js`
- Modify: `server/src/services/settings.js` (`DEFAULT_SETTINGS.blackjack` 추가)
- Test: `server/test/blackjack-engine.test.js`

**Interfaces:**
- Consumes: 카드 형태 `{ rank, suit, code }`
- Produces:
  - `DEFAULT_SETTINGS.blackjack = { decks: 6, hitSoft17: false, surrenderAllowed: true, doubleAllowed: true, splitAllowed: true, blackjackPayout: 1.5, minBet: 100, maxBet: 10000, betSeconds: 20, turnSeconds: 15 }`
  - `handValue(cards) → { total, soft }` — A는 11로 세다 버스트 시 1로 강등. `soft`는 A가 11로 계산 중일 때 true
  - `isBlackjack(cards) → boolean` — 첫 2장 21
  - `isBust(cards) → boolean`
  - `dealerShouldHit(cards, hitSoft17) → boolean` — 16 이하 히트, soft 17은 설정에 따름
  - `settleHand({ playerCards, dealerCards, bet, doubled, surrendered, rules }) → { payout, outcome }`
    - `payout`은 **플레이어에게 돌려줄 총액**(원금 포함). outcome: `'blackjack'|'win'|'push'|'lose'|'bust'|'surrender'`
    - 서렌더: `floor(bet/2)` 반환. 버스트: 0. 블랙잭(스플릿 아닌 첫 2장): `bet + floor(bet * rules.blackjackPayout)` (딜러도 블랙잭이면 push). 더블: bet은 이미 2배로 전달된 값 사용(호출자가 합산). 승: `bet*2`, 무: `bet`, 패: 0

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/blackjack-engine.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { handValue, isBlackjack, isBust, dealerShouldHit, settleHand } from '../src/games/blackjack/engine.js'

const c = (rank) => ({ rank, suit: 'S', code: rank + 'S' })
const rules = { blackjackPayout: 1.5 }

describe('blackjack engine', () => {
  it('핸드 값: 하드/소프트/에이스 강등', () => {
    expect(handValue([c('10'), c('7')])).toEqual({ total: 17, soft: false })
    expect(handValue([c('A'), c('6')])).toEqual({ total: 17, soft: true })
    expect(handValue([c('A'), c('6'), c('10')])).toEqual({ total: 17, soft: false })
    expect(handValue([c('A'), c('A'), c('9')])).toEqual({ total: 21, soft: true })
    expect(isBust([c('10'), c('9'), c('5')])).toBe(true)
  })

  it('블랙잭 판정은 첫 2장 21만', () => {
    expect(isBlackjack([c('A'), c('K')])).toBe(true)
    expect(isBlackjack([c('7'), c('7'), c('7')])).toBe(false)
  })

  it('딜러: 16 히트, 하드17 스탠드, 소프트17은 설정에 따름', () => {
    expect(dealerShouldHit([c('10'), c('6')], false)).toBe(true)
    expect(dealerShouldHit([c('10'), c('7')], false)).toBe(false)
    expect(dealerShouldHit([c('A'), c('6')], false)).toBe(false)
    expect(dealerShouldHit([c('A'), c('6')], true)).toBe(true)
  })

  it('정산: 블랙잭 배당·승·무·패·버스트·서렌더', () => {
    const dealer17 = [c('10'), c('7')]
    expect(settleHand({ playerCards: [c('A'), c('K')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 250, outcome: 'blackjack' })
    expect(settleHand({ playerCards: [c('A'), c('K')], dealerCards: [c('A'), c('Q')], bet: 100, rules }))
      .toEqual({ payout: 100, outcome: 'push' })
    expect(settleHand({ playerCards: [c('10'), c('9')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 200, outcome: 'win' })
    expect(settleHand({ playerCards: [c('10'), c('7')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 100, outcome: 'push' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 0, outcome: 'lose' })
    expect(settleHand({ playerCards: [c('10'), c('9'), c('5')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 0, outcome: 'bust' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: [c('10'), c('6'), c('10')], bet: 100, rules }))
      .toEqual({ payout: 200, outcome: 'win' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: dealer17, bet: 100, surrendered: true, rules }))
      .toEqual({ payout: 50, outcome: 'surrender' })
  })

  it('6:5 배당 설정 반영', () => {
    const r = settleHand({ playerCards: [c('A'), c('K')], dealerCards: [c('10'), c('7')], bet: 100, rules: { blackjackPayout: 1.2 } })
    expect(r.payout).toBe(220)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/services/settings.js`의 `DEFAULT_SETTINGS`에 추가:
```js
  blackjack: {
    decks: 6,
    hitSoft17: false,
    surrenderAllowed: true,
    doubleAllowed: true,
    splitAllowed: true,
    blackjackPayout: 1.5,
    minBet: 100,
    maxBet: 10000,
    betSeconds: 20,
    turnSeconds: 15,
  },
```

`server/src/games/blackjack/engine.js`:
```js
export function handValue(cards) {
  let total = 0
  let aces = 0
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11
      aces++
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10
    } else {
      total += Number(card.rank)
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21
}

export function isBust(cards) {
  return handValue(cards).total > 21
}

export function dealerShouldHit(cards, hitSoft17) {
  const { total, soft } = handValue(cards)
  if (total < 17) return true
  if (total === 17 && soft && hitSoft17) return true
  return false
}

export function settleHand({ playerCards, dealerCards, bet, doubled = false, surrendered = false, fromSplit = false, rules }) {
  if (surrendered) return { payout: Math.floor(bet / 2), outcome: 'surrender' }
  if (isBust(playerCards)) return { payout: 0, outcome: 'bust' }

  const playerBJ = !fromSplit && isBlackjack(playerCards)
  const dealerBJ = isBlackjack(dealerCards)
  if (playerBJ && dealerBJ) return { payout: bet, outcome: 'push' }
  if (playerBJ) return { payout: bet + Math.floor(bet * rules.blackjackPayout), outcome: 'blackjack' }
  if (dealerBJ) return { payout: 0, outcome: 'lose' }

  const p = handValue(playerCards).total
  const d = handValue(dealerCards).total
  if (d > 21 || p > d) return { payout: bet * 2, outcome: 'win' }
  if (p === d) return { payout: bet, outcome: 'push' }
  return { payout: 0, outcome: 'lose' }
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 51 tests)

```bash
git add server/src server/test/blackjack-engine.test.js
git commit -m "feat: 블랙잭 엔진 (soft17·서렌더·배당 설정 반영)"
```

---

### Task 3: 러너 레지스트리 + 테이블 서비스 · REST (관리자 CRUD / 로비 목록)

**Files:**
- Create: `server/src/games/registry.js`, `server/src/services/tables.js`, `server/src/routes/tables.js`, `server/src/routes/admin-tables.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/tables.test.js`

**Interfaces:**
- Consumes: `requireAuth`/`requireAdmin`, `createApp(db, ctx)`
- Produces:
  - `registry.js`: `registerRunner(tableId, runner)`, `getRunner(tableId)`, `removeRunner(tableId)`, `allRunners()`, `clearRunners()`(테스트용)
  - `tables.js` 서비스:
    - `GAME_KEYS = ['blackjack', 'roulette', 'baccarat']` (멀티 테이블 게임만)
    - `listTables(db, game?) → [{ id, game, name, status, limits, playerCount }]` — `playerCount = getRunner(id)?.playerCount() ?? 0`
    - `createTable(db, { game, name, limits }, createdBy) → row` — 검증: game은 GAME_KEYS, name 1~20자, limits는 null 또는 `{minBet, maxBet}` 양의 정수·min<max. 위반 시 `ValidationError`(message 한국어) throw
    - `updateTable(db, id, { name?, limits? }) → row`
    - `setTableStatus(db, id, 'open'|'closed')`, `deleteTable(db, id)`
    - `broadcastTables(db, io)` — `io.emit('tables:update', { tables: listTables(db) })` (io 없으면 no-op)
  - REST:
    - `GET /api/tables` (로그인) → `{ tables }`
    - `POST /api/admin/tables { game, name, limits? }` → 201 `{ table }` — 생성 후 러너 기동은 **ctx.startRunner(table)** 콜백(Task 6에서 주입, 없으면 생략) + `broadcastTables`
    - `PUT /api/admin/tables/:id { name?, limits? }` → `{ table }`
    - `POST /api/admin/tables/:id/close` / `POST /api/admin/tables/:id/reopen` — close 시 `getRunner(id)?.stop({ refund: true })` + `removeRunner`, reopen 시 `ctx.startRunner`
    - `DELETE /api/admin/tables/:id` — close와 동일 처리 후 행 삭제

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/tables.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'
import { registerRunner, clearRunners } from '../src/games/registry.js'

describe('tables', () => {
  let db, app, adminToken, userToken, started, stopped

  beforeEach(async () => {
    db = createDb()
    clearRunners()
    started = []
    stopped = []
    app = createApp(db, {
      io: { emit() {}, to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) },
      startRunner: (table) => started.push(table.id),
    })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
    userToken = (await request(app).post('/api/auth/signup')
      .send({ username: 'player1', password: 'password1', nickname: '플레이어', agreed: true })).body.token
  })

  async function createTable(body) {
    return request(app).post('/api/admin/tables').set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  it('관리자가 테이블을 만들면 러너가 기동되고 목록에 보인다', async () => {
    const res = await createTable({ game: 'blackjack', name: '블랙잭 1번', limits: { minBet: 100, maxBet: 5000 } })
    expect(res.status).toBe(201)
    expect(started).toContain(res.body.table.id)
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables[0]).toMatchObject({ name: '블랙잭 1번', game: 'blackjack', playerCount: 0 })
    expect(list.body.tables[0].limits).toEqual({ minBet: 100, maxBet: 5000 })
  })

  it('검증: 잘못된 게임/이름/한도는 400', async () => {
    expect((await createTable({ game: 'poker', name: 'x' })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: '' })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'ok', limits: { minBet: 500, maxBet: 100 } })).status).toBe(400)
  })

  it('일반 유저는 생성 불가(403)', async () => {
    const res = await request(app).post('/api/admin/tables')
      .set('Authorization', `Bearer ${userToken}`).send({ game: 'blackjack', name: 'x' })
    expect(res.status).toBe(403)
  })

  it('닫기 시 러너가 stop(refund)되고 목록에서 closed로 보인다', async () => {
    const { body } = await createTable({ game: 'blackjack', name: '닫을 테이블' })
    const id = body.table.id
    registerRunner(id, { playerCount: () => 3, stop: (o) => stopped.push(o) })
    await request(app).post(`/api/admin/tables/${id}/close`).set('Authorization', `Bearer ${adminToken}`)
    expect(stopped).toEqual([{ refund: true }])
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables[0].status).toBe('closed')
  })

  it('삭제하면 목록에서 사라진다', async () => {
    const { body } = await createTable({ game: 'blackjack', name: '삭제 테이블' })
    await request(app).delete(`/api/admin/tables/${body.table.id}`).set('Authorization', `Bearer ${adminToken}`)
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables.length).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/games/registry.js`:
```js
const runners = new Map()

export function registerRunner(tableId, runner) {
  runners.set(Number(tableId), runner)
}
export function getRunner(tableId) {
  return runners.get(Number(tableId))
}
export function removeRunner(tableId) {
  runners.delete(Number(tableId))
}
export function allRunners() {
  return [...runners.values()]
}
export function clearRunners() {
  runners.clear()
}
```

`server/src/services/tables.js`:
```js
import { getRunner } from '../games/registry.js'

export const GAME_KEYS = ['blackjack', 'roulette', 'baccarat']

export class ValidationError extends Error {}

function rowToTable(row) {
  return {
    id: row.id,
    game: row.game,
    name: row.name,
    status: row.status,
    limits: row.limits_json ? JSON.parse(row.limits_json) : null,
    playerCount: getRunner(row.id)?.playerCount() ?? 0,
  }
}

function validate({ game, name, limits }) {
  if (!GAME_KEYS.includes(game)) throw new ValidationError('지원하지 않는 게임입니다.')
  if (!name?.trim() || name.trim().length > 20) throw new ValidationError('테이블 이름은 1~20자여야 합니다.')
  if (limits != null) {
    const { minBet, maxBet } = limits
    if (!Number.isInteger(minBet) || !Number.isInteger(maxBet) || minBet < 1 || minBet >= maxBet) {
      throw new ValidationError('베팅 한도는 양의 정수이며 최소 < 최대여야 합니다.')
    }
  }
}

export function listTables(db, game = null) {
  const rows = game
    ? db.prepare('SELECT * FROM tables WHERE game = ? ORDER BY id').all(game)
    : db.prepare('SELECT * FROM tables ORDER BY id').all()
  return rows.map(rowToTable)
}

export function getTable(db, id) {
  const row = db.prepare('SELECT * FROM tables WHERE id = ?').get(id)
  return row ? rowToTable(row) : null
}

export function createTable(db, { game, name, limits = null }, createdBy) {
  validate({ game, name, limits })
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO tables (game, name, limits_json, created_by) VALUES (?, ?, ?, ?)'
  ).run(game, name.trim(), limits ? JSON.stringify(limits) : null, createdBy)
  return getTable(db, id)
}

export function updateTable(db, id, { name, limits }) {
  const current = getTable(db, id)
  if (!current) throw new ValidationError('테이블을 찾을 수 없습니다.')
  const next = { game: current.game, name: name ?? current.name, limits: limits === undefined ? current.limits : limits }
  validate(next)
  db.prepare('UPDATE tables SET name = ?, limits_json = ? WHERE id = ?')
    .run(next.name.trim(), next.limits ? JSON.stringify(next.limits) : null, id)
  return getTable(db, id)
}

export function setTableStatus(db, id, status) {
  db.prepare('UPDATE tables SET status = ? WHERE id = ?').run(status, id)
}

export function deleteTable(db, id) {
  db.prepare('DELETE FROM tables WHERE id = ?').run(id)
}

export function broadcastTables(db, io) {
  io?.emit('tables:update', { tables: listTables(db) })
}
```

`server/src/routes/tables.js`:
```js
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listTables } from '../services/tables.js'

export function tablesRouter(db) {
  const r = Router()
  r.get('/', requireAuth(db), (req, res) => res.json({ tables: listTables(db) }))
  return r
}
```

`server/src/routes/admin-tables.js`:
```js
import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import {
  createTable, updateTable, setTableStatus, deleteTable, getTable, broadcastTables, ValidationError,
} from '../services/tables.js'
import { getRunner, removeRunner } from '../games/registry.js'

export function adminTablesRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  function handle(res, fn) {
    try {
      fn()
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message })
      throw e
    }
  }

  function stopRunnerFor(id) {
    getRunner(id)?.stop({ refund: true })
    removeRunner(id)
  }

  r.post('/', (req, res) => handle(res, () => {
    const table = createTable(db, req.body ?? {}, req.user.id)
    ctx.startRunner?.(table)
    broadcastTables(db, ctx.io)
    res.status(201).json({ table })
  }))

  r.put('/:id', (req, res) => handle(res, () => {
    const table = updateTable(db, req.params.id, req.body ?? {})
    broadcastTables(db, ctx.io)
    res.json({ table })
  }))

  r.post('/:id/close', (req, res) => {
    if (!getTable(db, req.params.id)) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    stopRunnerFor(Number(req.params.id))
    setTableStatus(db, req.params.id, 'closed')
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  r.post('/:id/reopen', (req, res) => {
    const table = getTable(db, req.params.id)
    if (!table) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    setTableStatus(db, req.params.id, 'open')
    ctx.startRunner?.(getTable(db, req.params.id))
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  r.delete('/:id', (req, res) => {
    if (!getTable(db, req.params.id)) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    stopRunnerFor(Number(req.params.id))
    deleteTable(db, req.params.id)
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  return r
}
```

`server/src/app.js` 마운트 추가:
```js
import { tablesRouter } from './routes/tables.js'
import { adminTablesRouter } from './routes/admin-tables.js'
// ...
app.use('/api/tables', tablesRouter(db))
app.use('/api/admin/tables', adminTablesRouter(db, ctx))
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 56 tests)

```bash
git add server/src server/test/tables.test.js
git commit -m "feat: 테이블 서비스·레지스트리·관리자 CRUD API"
```

---

### Task 4: 관리자 규칙 설정 API

**Files:**
- Create: `server/src/routes/admin-settings.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/admin-settings.test.js`

**Interfaces:**
- Consumes: `getSettings`/`saveSettings`/`DEFAULT_SETTINGS`
- Produces:
  - `GET /api/admin/settings/:game` → `{ settings }` (game은 DEFAULT_SETTINGS의 키만 허용: economy, slots, blackjack — 플랜 5에서 roulette·baccarat 추가되면 자동 허용)
  - `PUT /api/admin/settings/:game { ...partial }` → `{ settings }` — 검증 후 저장. 검증 규칙:
    - 알 수 없는 키 → 400
    - 기본값이 숫자인 키: 숫자이며 0 이상 (jackpotRate는 0~0.2, blackjackPayout은 1~2, decks는 1~8 정수)
    - 기본값이 불리언인 키: 불리언
    - minBet/maxBet 동시 검증: minBet < maxBet
  - 저장 성공 시 `ctx.io?.emit('settings:updated', { game })` (게임 뷰가 다음 라운드 안내에 사용 가능 — 수신은 선택)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/admin-settings.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

describe('admin settings', () => {
  let db, app, adminToken
  beforeEach(async () => {
    db = createDb()
    app = createApp(db, { io: { emit() {}, to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) } })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
  })

  it('블랙잭 설정을 조회·수정한다', async () => {
    const get = await request(app).get('/api/admin/settings/blackjack').set('Authorization', `Bearer ${adminToken}`)
    expect(get.body.settings.decks).toBe(6)
    const put = await request(app).put('/api/admin/settings/blackjack')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decks: 8, hitSoft17: true, surrenderAllowed: false })
    expect(put.status).toBe(200)
    expect(put.body.settings).toMatchObject({ decks: 8, hitSoft17: true, surrenderAllowed: false, minBet: 100 })
  })

  it('검증: 범위·타입·미지 키·min>=max는 400', async () => {
    const cases = [
      { decks: 9 },
      { decks: 2.5 },
      { hitSoft17: 'yes' },
      { unknownKey: 1 },
      { minBet: 5000, maxBet: 100 },
      { blackjackPayout: 3 },
    ]
    for (const body of cases) {
      const res = await request(app).put('/api/admin/settings/blackjack')
        .set('Authorization', `Bearer ${adminToken}`).send(body)
      expect(res.status).toBe(400)
    }
  })

  it('없는 게임 키는 404', async () => {
    const res = await request(app).get('/api/admin/settings/poker').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/routes/admin-settings.js`:
```js
import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../services/settings.js'

const RANGES = {
  decks: { min: 1, max: 8, integer: true },
  jackpotRate: { min: 0, max: 0.2 },
  blackjackPayout: { min: 1, max: 2 },
}

export function adminSettingsRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.use('/:game', (req, res, next) => {
    if (!DEFAULT_SETTINGS[req.params.game]) return res.status(404).json({ error: '없는 설정 그룹입니다.' })
    next()
  })

  r.get('/:game', (req, res) => res.json({ settings: getSettings(db, req.params.game) }))

  r.put('/:game', (req, res) => {
    const game = req.params.game
    const defaults = DEFAULT_SETTINGS[game]
    const partial = req.body ?? {}

    for (const [key, value] of Object.entries(partial)) {
      if (!(key in defaults)) return res.status(400).json({ error: `알 수 없는 설정 키: ${key}` })
      const def = defaults[key]
      if (typeof def === 'boolean') {
        if (typeof value !== 'boolean') return res.status(400).json({ error: `${key}는 켬/끔 값이어야 합니다.` })
      } else {
        if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
          return res.status(400).json({ error: `${key}는 0 이상의 숫자여야 합니다.` })
        }
        const range = RANGES[key]
        if (range) {
          if (range.integer && !Number.isInteger(value)) return res.status(400).json({ error: `${key}는 정수여야 합니다.` })
          if (value < range.min || value > range.max) {
            return res.status(400).json({ error: `${key}는 ${range.min}~${range.max} 범위여야 합니다.` })
          }
        }
      }
    }

    const merged = { ...getSettings(db, game), ...partial }
    if ('minBet' in merged && 'maxBet' in merged && merged.minBet >= merged.maxBet) {
      return res.status(400).json({ error: '최소 베팅은 최대 베팅보다 작아야 합니다.' })
    }

    const settings = saveSettings(db, game, partial, req.user.id)
    ctx.io?.emit('settings:updated', { game })
    res.json({ settings })
  })

  return r
}
```

`server/src/app.js` 마운트 추가:
```js
import { adminSettingsRouter } from './routes/admin-settings.js'
// ...
app.use('/api/admin/settings', adminSettingsRouter(db, ctx))
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 59 tests)

```bash
git add server/src server/test/admin-settings.test.js
git commit -m "feat: 관리자 게임 규칙 설정 API (검증 포함)"
```

---

### Task 5: BlackjackRunner (서버 상태 머신)

**Files:**
- Create: `server/src/games/blackjack/BlackjackRunner.js`
- Test: `server/test/blackjack-runner.test.js`

**Interfaces:**
- Consumes: cards, blackjack engine, `applyTransaction`, `getSettings`, rounds/bets 테이블
- Produces (`new BlackjackRunner({ db, nsp, table, timers?, rng?, onSeatsChange? })`):
  - `nsp`는 `{ to(room) → { emit(event, payload) } }` 형태면 충분 (테스트에서 fake 주입)
  - `timers = { setTimeout, clearTimeout }` 주입 가능 (기본: 전역)
  - 메서드 (전부 `{ ok: true } | { error: '...' }` 반환):
    - `sit(userId, nickname, seatIdx)` — 0~6, 빈 좌석, 미착석자만. 첫 착석 시 `waiting → betting` 시작
    - `leave(userId)` — 베팅한 라운드 진행 중이면 좌석 유지(자동 스탠드 처리), 아니면 즉시 해제
    - `onDisconnect(userId)` — leave와 동일 정책
    - `placeBet(userId, amount)` — betting 페이즈만, 좌석당 1회, 한도(테이블 오버라이드 우선)·정수 검증, 즉시 차감
    - `action(userId, move)` — `'hit'|'stand'|'double'|'split'|'surrender'`, 자기 턴만
  - `playerCount() → number`, `snapshot() → 상태 객체`, `start()` (betting 시작 예약), `stop({ refund })`
  - 페이즈: `waiting → betting → acting → dealer → result → betting…` (베팅 없으면 betting 반복, 착석 0명이면 waiting)
  - snapshot 형태:
    ```
    { tableId, name, phase, phaseEndsAt, seats: [null | { userId, nickname, bet, hands: [{ cards, total, soft, doubled, surrendered, done, result? }], activeHand }],
      dealer: { cards, total, hidden },  // hidden=true면 두 번째 카드는 { code: 'BACK' }으로 마스킹
      currentSeat, rules: { minBet, maxBet, betSeconds, turnSeconds, surrenderAllowed, doubleAllowed, splitAllowed } }
    ```
  - 브로드캐스트: 상태 변화마다 `table:state` 스냅샷 1종만 (클라 구현 단순화)
  - 라운드 시작 시 rounds INSERT, 정산 시 bets INSERT + rounds 업데이트
  - 슈: 라운드 시작 시 남은 카드가 `decks×52×0.25` 미만이면 재생성

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/blackjack-runner.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { BlackjackRunner } from '../src/games/blackjack/BlackjackRunner.js'
import { saveSettings } from '../src/services/settings.js'

function makeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1
        pending.set(seq, { fn, ms })
        return seq
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fire() {
      const entries = [...pending.entries()]
      pending.clear()
      entries.forEach(([, { fn }]) => fn())
    },
    count: () => pending.size,
  }
}

const fakeNsp = { to: () => ({ emit() {} }) }

function makeUser(db, username, balance = 10000) {
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO users (username, password_hash, nickname, balance) VALUES (?, ?, ?, ?)')
    .run(username, 'h', username, balance)
  return Number(id)
}

describe('BlackjackRunner', () => {
  let db, table, u1, u2, t

  beforeEach(() => {
    db = createDb()
    u1 = makeUser(db, 'p1')
    u2 = makeUser(db, 'p2')
    db.prepare("INSERT INTO tables (game, name) VALUES ('blackjack', '테스트')").run()
    table = { id: 1, game: 'blackjack', name: '테스트', limits_json: null }
    t = makeTimers()
  })

  function makeRunner(rng = Math.random) {
    return new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers, rng })
  }

  it('착석하면 베팅 페이즈가 시작된다', () => {
    const r = makeRunner()
    expect(r.snapshot().phase).toBe('waiting')
    expect(r.sit(u1, 'p1', 2).ok).toBe(true)
    expect(r.snapshot().phase).toBe('betting')
    expect(r.snapshot().seats[2].nickname).toBe('p1')
  })

  it('중복 착석·점유 좌석은 거부된다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.sit(u2, 'p2', 0).error).toBeTruthy()
    expect(r.sit(u1, 'p1', 1).error).toBeTruthy()
  })

  it('베팅하면 즉시 차감되고, 한도 위반·중복 베팅은 거부', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.placeBet(u1, 50).error).toBeTruthy()
    expect(r.placeBet(u1, 500).ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(9500)
    expect(r.placeBet(u1, 500).error).toBeTruthy()
  })

  it('베팅 마감 → 딜링 → 전원 자동 스탠드 → 딜러 → 정산 → 다음 베팅 (풀 사이클)', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.sit(u2, 'p2', 1)
    r.placeBet(u1, 1000)
    r.placeBet(u2, 500)
    t.fire() // 베팅 마감 → 딜링 → acting (첫 턴 타이머 장전)
    expect(r.snapshot().phase).toBe('acting')
    expect(r.snapshot().seats[0].hands[0].cards.length).toBe(2)
    expect(r.snapshot().dealer.hidden).toBe(true)
    t.fire() // seat0 자동 스탠드 → seat1 턴
    t.fire() // seat1 자동 스탠드 → dealer 페이즈 (result 예약)
    t.fire() // result → 다음 betting 예약까지
    const snap = r.snapshot()
    expect(['result', 'betting']).toContain(snap.phase)
    // 정산 완료: bets 2건 기록, 딜러 공개
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(2)
    const round = db.prepare('SELECT * FROM rounds').get()
    expect(round.ended_at).toBeTruthy()
    // 두 유저 잔액 합 = 20000 - 1500 + 총지급액 (지급액은 결과에 따라 0 이상)
    const balSum = db.prepare('SELECT SUM(balance) s FROM users').get().s
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balSum).toBe(20000 - 1500 + payoutSum)
  })

  it('테이블 한도 오버라이드가 전역 설정보다 우선한다', () => {
    saveSettings(db, 'blackjack', { minBet: 100 }, null)
    table.limits_json = JSON.stringify({ minBet: 1000, maxBet: 2000 })
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.placeBet(u1, 500).error).toBeTruthy()
    expect(r.placeBet(u1, 1000).ok).toBe(true)
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링 → acting
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(10000)
  })

  it('hit으로 버스트하면 즉시 다음으로 넘어가고 정산에서 0을 받는다', () => {
    // 항상 10만 나오는 슈: rng=0이면 셔플이 결정적 → 대신 카드 강제 주입
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링
    r.shoe = [
      { rank: '10', suit: 'S', code: '10S' },
      { rank: '10', suit: 'H', code: '10H' },
      { rank: '10', suit: 'D', code: '10D' },
    ]
    r.seats[0].hands[0].cards = [
      { rank: '10', suit: 'C', code: '10C' },
      { rank: '9', suit: 'C', code: '9C' },
    ]
    const res = r.action(u1, 'hit') // 19 + 10 = 버스트
    expect(res.ok).toBe(true)
    expect(r.seats[0].hands[0].done).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/games/blackjack/BlackjackRunner.js`:
```js
import { buildShoe, drawCard } from '../cards.js'
import { handValue, isBlackjack, isBust, dealerShouldHit, settleHand } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

const SEAT_COUNT = 7

export class BlackjackRunner {
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
    this.seats = Array(SEAT_COUNT).fill(null)
    this.dealerCards = []
    this.dealerHidden = true
    this.shoe = []
    this.roundId = null
    this.rules_ = null
    this.currentSeat = -1
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  // ── 유틸 ──────────────────────────────────────────────
  rules() {
    const s = getSettings(this.db, 'blackjack')
    const limits = this.table.limits_json ? JSON.parse(this.table.limits_json) : null
    return limits ? { ...s, ...limits } : s
  }

  playerCount() {
    return this.seats.filter(Boolean).length
  }

  seatOf(userId) {
    return this.seats.findIndex((s) => s?.userId === userId)
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
      currentSeat: this.currentSeat,
      dealer: {
        cards: this.dealerCards.map((c, i) =>
          this.dealerHidden && i === 1 ? { code: 'BACK' } : c
        ),
        total: this.dealerHidden ? null : handValue(this.dealerCards).total,
        hidden: this.dealerHidden,
      },
      seats: this.seats.map((s) =>
        s
          ? {
              userId: s.userId,
              nickname: s.nickname,
              bet: s.bet,
              activeHand: s.activeHand,
              hands: s.hands.map((h) => ({
                cards: h.cards,
                ...handValue(h.cards),
                doubled: h.doubled,
                surrendered: h.surrendered,
                done: h.done,
                result: h.result ?? null,
              })),
            }
          : null
      ),
      rules: {
        minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds, turnSeconds: r.turnSeconds,
        surrenderAllowed: r.surrenderAllowed, doubleAllowed: r.doubleAllowed, splitAllowed: r.splitAllowed,
      },
    }
  }

  // ── 착석/이탈 ─────────────────────────────────────────
  sit(userId, nickname, seatIdx) {
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= SEAT_COUNT) return { error: '잘못된 좌석입니다.' }
    if (this.seats[seatIdx]) return { error: '이미 다른 플레이어가 앉아 있습니다.' }
    if (this.seatOf(userId) !== -1) return { error: '이미 착석 중입니다.' }
    this.seats[seatIdx] = { userId, nickname, bet: 0, staked: 0, hands: [], activeHand: 0, leaving: false }
    if (this.phase === 'waiting') this.startBetting()
    this.onSeatsChange()
    this.broadcast()
    return { ok: true }
  }

  leave(userId) {
    const idx = this.seatOf(userId)
    if (idx === -1) return { error: '착석 중이 아닙니다.' }
    const seat = this.seats[idx]
    const inRound = seat.bet > 0 && ['acting', 'dealer', 'result'].includes(this.phase)
    if (inRound) {
      seat.leaving = true
      if (this.phase === 'acting' && this.currentSeat === idx) this.autoStand()
    } else {
      this.seats[idx] = null
      if (this.playerCount() === 0) this.goWaiting()
    }
    this.onSeatsChange()
    this.broadcast()
    return { ok: true }
  }

  onDisconnect(userId) {
    if (this.seatOf(userId) !== -1) this.leave(userId)
  }

  // ── 베팅 ──────────────────────────────────────────────
  placeBet(userId, amount) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const idx = this.seatOf(userId)
    if (idx === -1) return { error: '먼저 좌석에 앉아 주세요.' }
    const seat = this.seats[idx]
    if (seat.bet > 0) return { error: '이미 베팅했습니다.' }
    const r = this.rules_
    if (!Number.isInteger(amount) || amount < r.minBet || amount > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, {
        userId, type: 'bet', amount: -amount, game: 'blackjack', refRoundId: this.roundId,
      })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    seat.bet = amount
    seat.staked = amount
    this.broadcast()
    return { ok: true }
  }

  // ── 페이즈 전이 ───────────────────────────────────────
  goWaiting() {
    this.phase = 'waiting'
    this.clearTimer()
    this.currentSeat = -1
    this.broadcast()
  }

  startBetting() {
    if (this.stopped) return
    if (this.playerCount() === 0) return this.goWaiting()
    this.rules_ = this.rules() // 라운드 시작 시점 규칙 고정 (다음 라운드부터 반영 규칙)
    this.phase = 'betting'
    this.dealerCards = []
    this.dealerHidden = true
    this.currentSeat = -1
    for (const seat of this.seats.filter(Boolean)) {
      seat.bet = 0
      seat.staked = 0
      seat.hands = []
      seat.activeHand = 0
    }
    const { lastInsertRowid } = this.db.prepare(
      "INSERT INTO rounds (game, table_id) VALUES ('blackjack', ?)"
    ).run(this.table.id)
    this.roundId = Number(lastInsertRowid)
    this.schedule(this.rules_.betSeconds * 1000, () => this.closeBetting())
    this.broadcast()
  }

  closeBetting() {
    const bettingSeats = this.seats.filter((s) => s?.bet > 0)
    if (bettingSeats.length === 0) {
      this.db.prepare('DELETE FROM rounds WHERE id = ?').run(this.roundId)
      this.roundId = null
      return this.startBetting() // 착석자가 있으면 다음 베팅 창, 없으면 waiting
    }
    // 슈 확인
    const needed = this.rules_.decks * 52 * 0.25
    if (this.shoe.length < needed) this.shoe = buildShoe(this.rules_.decks, this.rng)
    // 딜링: 각 좌석 2장, 딜러 2장(2번째 히든)
    for (const seat of bettingSeats) {
      seat.hands = [{ cards: [drawCard(this.shoe), drawCard(this.shoe)], doubled: false, surrendered: false, done: false, fromSplit: false }]
      seat.activeHand = 0
    }
    this.dealerCards = [drawCard(this.shoe), drawCard(this.shoe)]
    this.dealerHidden = true
    // 딜러 블랙잭이면 즉시 공개·정산
    if (isBlackjack(this.dealerCards)) {
      this.phase = 'dealer'
      this.dealerHidden = false
      this.broadcast()
      return this.schedule(1500, () => this.settleRound())
    }
    // 블랙잭인 플레이어는 자동 완료
    for (const seat of bettingSeats) {
      if (isBlackjack(seat.hands[0].cards)) seat.hands[0].done = true
    }
    this.phase = 'acting'
    this.currentSeat = -1
    this.broadcast()
    this.advanceTurn()
  }

  advanceTurn() {
    // 현재 좌석에 남은 핸드가 있으면 그 핸드로, 아니면 다음 좌석으로
    for (let i = Math.max(this.currentSeat, 0); i < SEAT_COUNT; i++) {
      const seat = this.seats[i]
      if (!seat || seat.bet === 0) continue
      const handIdx = seat.hands.findIndex((h) => !h.done)
      if (handIdx !== -1) {
        this.currentSeat = i
        seat.activeHand = handIdx
        this.schedule(this.rules_.turnSeconds * 1000, () => this.autoStand())
        this.broadcast()
        return
      }
    }
    this.dealerPhase()
  }

  autoStand() {
    const seat = this.seats[this.currentSeat]
    if (seat) {
      const hand = seat.hands[seat.activeHand]
      if (hand && !hand.done) hand.done = true
    }
    this.advanceTurn()
  }

  currentHand(userId) {
    const idx = this.seatOf(userId)
    if (this.phase !== 'acting' || idx !== this.currentSeat) return null
    const seat = this.seats[idx]
    return { seat, hand: seat.hands[seat.activeHand] }
  }

  action(userId, move) {
    const cur = this.currentHand(userId)
    if (!cur) return { error: '지금은 행동할 수 없습니다.' }
    const { seat, hand } = cur
    const r = this.rules_
    const firstAction = hand.cards.length === 2 && !hand.doubled

    if (move === 'hit') {
      hand.cards.push(drawCard(this.shoe))
      if (handValue(hand.cards).total >= 21) hand.done = true
    } else if (move === 'stand') {
      hand.done = true
    } else if (move === 'double') {
      if (!r.doubleAllowed || !firstAction) return { error: '지금은 더블할 수 없습니다.' }
      const extra = hand.doubled ? 0 : seat.bet
      try {
        applyTransaction(this.db, { userId, type: 'bet', amount: -extra, game: 'blackjack', refRoundId: this.roundId })
      } catch (e) {
        if (e instanceof InsufficientBalanceError) return { error: e.message }
        throw e
      }
      seat.staked += extra
      hand.doubled = true
      hand.cards.push(drawCard(this.shoe))
      hand.done = true
    } else if (move === 'split') {
      if (!r.splitAllowed || seat.hands.length > 1 || !firstAction) return { error: '지금은 스플릿할 수 없습니다.' }
      if (hand.cards[0].rank !== hand.cards[1].rank) return { error: '같은 숫자 카드만 스플릿할 수 있습니다.' }
      try {
        applyTransaction(this.db, { userId, type: 'bet', amount: -seat.bet, game: 'blackjack', refRoundId: this.roundId })
      } catch (e) {
        if (e instanceof InsufficientBalanceError) return { error: e.message }
        throw e
      }
      seat.staked += seat.bet
      const [c1, c2] = hand.cards
      seat.hands = [
        { cards: [c1, drawCard(this.shoe)], doubled: false, surrendered: false, done: false, fromSplit: true },
        { cards: [c2, drawCard(this.shoe)], doubled: false, surrendered: false, done: false, fromSplit: true },
      ]
      seat.activeHand = 0
    } else if (move === 'surrender') {
      if (!r.surrenderAllowed || !firstAction || seat.hands.length > 1) return { error: '지금은 서렌더할 수 없습니다.' }
      hand.surrendered = true
      hand.done = true
    } else {
      return { error: '알 수 없는 행동입니다.' }
    }

    if (hand.done || move === 'split') {
      if (seat.hands.every((h) => h.done)) this.advanceTurn()
      else {
        seat.activeHand = seat.hands.findIndex((h) => !h.done)
        this.schedule(r.turnSeconds * 1000, () => this.autoStand())
      }
    } else {
      this.schedule(r.turnSeconds * 1000, () => this.autoStand())
    }
    this.broadcast()
    return { ok: true }
  }

  dealerPhase() {
    this.phase = 'dealer'
    this.currentSeat = -1
    this.clearTimer()
    this.dealerHidden = false
    const anyLive = this.seats.some(
      (s) => s?.bet > 0 && s.hands.some((h) => !h.surrendered && !isBust(h.cards))
    )
    if (anyLive) {
      while (dealerShouldHit(this.dealerCards, this.rules_.hitSoft17)) {
        this.dealerCards.push(drawCard(this.shoe))
      }
    }
    this.broadcast()
    this.schedule(1500, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.dealerHidden = false
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    for (const seat of this.seats.filter((s) => s?.bet > 0)) {
      let totalPayout = 0
      for (const hand of seat.hands) {
        const handBet = hand.doubled ? seat.bet * 2 : seat.bet
        const { payout, outcome } = settleHand({
          playerCards: hand.cards,
          dealerCards: this.dealerCards,
          bet: handBet,
          surrendered: hand.surrendered,
          fromSplit: hand.fromSplit,
          rules: this.rules_,
        })
        hand.result = { payout, outcome }
        totalPayout += payout
      }
      if (totalPayout > 0) {
        applyTransaction(this.db, {
          userId: seat.userId, type: 'payout', amount: totalPayout, game: 'blackjack', refRoundId: this.roundId,
        })
      }
      insertBet.run(this.roundId, seat.userId, JSON.stringify({ bet: seat.bet, hands: seat.hands.length }), seat.staked, totalPayout)
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?").run(
      JSON.stringify({ dealer: this.dealerCards.map((c) => c.code) }),
      this.roundId
    )
    // 떠나기로 한 좌석 정리
    this.seats = this.seats.map((s) => (s?.leaving ? null : s))
    this.onSeatsChange()
    this.broadcast()
    this.schedule(5000, () => this.startBetting())
  }

  refundAll() {
    for (const seat of this.seats.filter((s) => s?.staked > 0)) {
      const settled = seat.hands.some((h) => h.result)
      if (!settled) {
        applyTransaction(this.db, {
          userId: seat.userId, type: 'payout', amount: seat.staked, game: 'blackjack',
          refRoundId: this.roundId, reason: '테이블 중단 환불',
        })
        seat.staked = 0
        seat.bet = 0
      }
    }
  }

  start() {
    if (this.playerCount() > 0) this.startBetting()
    else this.goWaiting()
  }

  stop({ refund = true } = {}) {
    this.stopped = true
    this.clearTimer()
    if (refund && ['betting', 'acting', 'dealer'].includes(this.phase)) this.refundAll()
    this.nsp.to(this.room).emit('table:closed', {})
  }
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 63 tests)

```bash
git add server/src server/test/blackjack-runner.test.js
git commit -m "feat: 블랙잭 라운드 러너 (서버 주도 상태 머신)"
```

---

### Task 6: 게임 네임스페이스 소켓 배선 + 기동 시 러너 시작

**Files:**
- Create: `server/src/sockets/game-namespace.js`, `server/src/games/index.js`
- Modify: `server/src/sockets/index.js`, `server/src/index.js`
- Test: `server/test/blackjack-socket.test.js`

**Interfaces:**
- Consumes: registry, BlackjackRunner, `verifyToken`, `broadcastTables`
- Produces:
  - `server/src/games/index.js`: `RUNNER_CLASSES = { blackjack: BlackjackRunner }` (플랜 5에서 roulette·baccarat 추가), `startRunner(db, io, table)` — 해당 게임 네임스페이스로 Runner 생성·등록·`start()`, `onSeatsChange`에 `broadcastTables(db, io)` 연결. `startAllOpenTables(db, io)` — status='open' 전체 기동
  - `attachGameNamespace(io, db, gameKey)` — `io.of('/'+gameKey)`에 인증 미들웨어 적용, 이벤트:
    - `table:join { tableId }, cb` — closed/없는 테이블이면 `cb({ error })`; room 참가 + `cb({ state: runner.snapshot() })`, `socket.data.tableId` 저장
    - `seat:join { seat }, cb` → `cb(runner.sit(userId, nickname, seat))`
    - `seat:leave cb` → `cb(runner.leave(userId))`
    - `bet:place { amount }, cb` → `cb(runner.placeBet(userId, amount))`
    - `action { move }, cb` → `cb(runner.action(userId, move))`
    - `disconnect` → `runner.onDisconnect(userId)`
  - `createSocketServer`가 각 GAME_KEYS 네임스페이스를 attach
  - `index.js` 기동 순서: `ctx.io = createSocketServer(...)` → `ctx.startRunner = (table) => startRunner(db, ctx.io, table)` → `startAllOpenTables(db, ctx.io)`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/blackjack-socket.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { io as ioc } from 'socket.io-client'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer } from '../src/sockets/index.js'
import { startRunner } from '../src/games/index.js'
import { createTable } from '../src/services/tables.js'
import { saveSettings } from '../src/services/settings.js'
import { clearRunners } from '../src/games/registry.js'

describe('blackjack socket', () => {
  let db, httpServer, io, port, token, tableId

  beforeAll(async () => {
    db = createDb()
    clearRunners()
    saveSettings(db, 'blackjack', { betSeconds: 600, turnSeconds: 600 }, null) // 테스트 중 자동 진행 방지
    const app = createApp(db, {})
    httpServer = createServer(app)
    io = createSocketServer(httpServer, db)
    await new Promise((r) => httpServer.listen(0, r))
    port = httpServer.address().port
    const res = await request(app).post('/api/auth/signup')
      .send({ username: 'bjsock', password: 'password1', nickname: '비제이', agreed: true })
    token = res.body.token
    const table = createTable(db, { game: 'blackjack', name: '소켓 테스트' }, null)
    tableId = table.id
    startRunner(db, io, { ...table, limits_json: null })
  })

  afterAll(() => new Promise((r) => httpServer.close(r)))

  function connect() {
    return ioc(`http://localhost:${port}/blackjack`, { auth: { token }, transports: ['websocket'] })
  }

  it('테이블 참가 → 착석 → 베팅이 소켓으로 동작한다', async () => {
    const socket = connect()
    await new Promise((res, rej) => {
      socket.on('connect', res)
      socket.on('connect_error', rej)
    })

    const joined = await socket.emitWithAck('table:join', { tableId })
    expect(joined.state.phase).toBe('waiting')

    const sat = await socket.emitWithAck('seat:join', { seat: 3 })
    expect(sat.ok).toBe(true)

    const stateAfterSit = await new Promise((r) => socket.once('table:state', r))
    expect(stateAfterSit.phase).toBe('betting')

    const bet = await socket.emitWithAck('bet:place', { amount: 500 })
    expect(bet.ok).toBe(true)
    expect(db.prepare("SELECT balance FROM users WHERE username = 'bjsock'").get().balance).toBe(9500)

    const badBet = await socket.emitWithAck('bet:place', { amount: 500 })
    expect(badBet.error).toBeTruthy()

    socket.close()
  })

  it('없는 테이블 참가는 에러', async () => {
    const socket = connect()
    await new Promise((r) => socket.on('connect', r))
    const res = await socket.emitWithAck('table:join', { tableId: 999 })
    expect(res.error).toBeTruthy()
    socket.close()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/games/index.js`:
```js
import { BlackjackRunner } from './blackjack/BlackjackRunner.js'
import { registerRunner } from './registry.js'
import { listTables, broadcastTables } from '../services/tables.js'

export const RUNNER_CLASSES = { blackjack: BlackjackRunner }

export function startRunner(db, io, table) {
  const RunnerClass = RUNNER_CLASSES[table.game]
  if (!RunnerClass) return null
  const nsp = io.of(`/${table.game}`)
  const row = db.prepare('SELECT * FROM tables WHERE id = ?').get(table.id)
  const runner = new RunnerClass({
    db,
    nsp,
    table: row,
    onSeatsChange: () => broadcastTables(db, io),
  })
  registerRunner(table.id, runner)
  runner.start()
  return runner
}

export function startAllOpenTables(db, io) {
  for (const table of listTables(db)) {
    if (table.status === 'open' && RUNNER_CLASSES[table.game]) startRunner(db, io, table)
  }
}
```

`server/src/sockets/game-namespace.js`:
```js
import { verifyToken } from '../middleware/auth.js'
import { getRunner } from '../games/registry.js'

export function attachGameNamespace(io, db, gameKey) {
  const nsp = io.of(`/${gameKey}`)

  nsp.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token)
      const user = db.prepare('SELECT id, nickname, banned FROM users WHERE id = ?').get(payload.sub)
      if (!user || user.banned) return next(new Error('인증에 실패했습니다.'))
      socket.data.userId = user.id
      socket.data.nickname = user.nickname
      next()
    } catch {
      next(new Error('인증에 실패했습니다.'))
    }
  })

  nsp.on('connection', (socket) => {
    const runner = () => getRunner(socket.data.tableId)

    socket.on('table:join', ({ tableId } = {}, cb = () => {}) => {
      const row = db.prepare("SELECT * FROM tables WHERE id = ? AND game = ? AND status = 'open'").get(tableId, gameKey)
      const r = getRunner(tableId)
      if (!row || !r) return cb({ error: '입장할 수 없는 테이블입니다.' })
      socket.data.tableId = Number(tableId)
      socket.join(`table:${tableId}`)
      cb({ state: r.snapshot() })
    })

    socket.on('seat:join', ({ seat } = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.sit(socket.data.userId, socket.data.nickname, seat) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('seat:leave', (cb = () => {}) => {
      const r = runner()
      cb(r ? r.leave(socket.data.userId) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('bet:place', ({ amount } = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.placeBet(socket.data.userId, amount) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('action', ({ move } = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.action(socket.data.userId, move) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('disconnect', () => {
      runner()?.onDisconnect(socket.data.userId)
    })
  })

  return nsp
}
```

`server/src/sockets/index.js` — `createSocketServer` 마지막(return 전)에 추가:
```js
import { attachGameNamespace } from './game-namespace.js'
import { GAME_KEYS } from '../services/tables.js'
// ...
  for (const gameKey of GAME_KEYS) attachGameNamespace(io, db, gameKey)
```

`server/src/index.js` — `ctx.io = createSocketServer(...)` 아래에 추가:
```js
import { startRunner, startAllOpenTables } from './games/index.js'
// ...
ctx.startRunner = (table) => startRunner(db, ctx.io, table)
startAllOpenTables(db, ctx.io)
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 65 tests)

```bash
git add server/src server/test/blackjack-socket.test.js
git commit -m "feat: 게임 네임스페이스 소켓 배선 및 기동 시 러너 시작"
```

---

### Task 7: 카드 에셋 도입 + CardImg 컴포넌트

**Files:**
- Create: `client/src/assets/cards/` (SVG 복사 + LICENSE), `client/src/components/CardImg.vue`

**Interfaces:**
- Consumes: 서버 카드 `code` (`'AS'`, `'10D'`, `'BACK'` …)
- Produces: `<CardImg :code="'AS'" />` — SVG 렌더, `code === 'BACK'`이면 CSS 카드 뒷면, 카드 비율 고정(w-12 sm:w-16)

- [ ] **Step 1: 에셋 다운로드·복사 (PowerShell)**

Run:
```powershell
git clone --depth 1 https://github.com/hayeah/playing-cards-assets "$env:TEMP\pca"
New-Item -ItemType Directory -Force client/src/assets/cards
Copy-Item "$env:TEMP\pca\svg-cards\*.svg" client/src/assets/cards/
Copy-Item "$env:TEMP\pca\LICENSE" client/src/assets/cards/LICENSE
Get-ChildItem client/src/assets/cards | Select-Object -First 10 Name
```
Expected: 52장 이상의 SVG + LICENSE. **파일명 규칙을 반드시 확인**(예: `ace_of_spades.svg`, `10_of_clubs.svg`, 그림 카드는 `jack_of_hearts2.svg`처럼 `2` 접미 변형이 있을 수 있음). 확인된 실제 파일명에 맞춰 Step 2의 `fileNameFor`를 조정한다.

- [ ] **Step 2: CardImg 구현**

`client/src/components/CardImg.vue`:
```vue
<script setup>
const props = defineProps({ code: { type: String, required: true } })

const files = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' })

const RANK_NAMES = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
}
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

function srcFor(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  // 그림 카드 '2' 접미 변형이 존재하면 우선 사용 (Step 1에서 확인한 실제 파일명 기준으로 조정)
  return (
    files[`../assets/cards/${rank}_of_${suit}2.svg`] ??
    files[`../assets/cards/${rank}_of_${suit}.svg`] ??
    null
  )
}
</script>

<template>
  <div v-if="code === 'BACK'"
    class="aspect-[5/7] w-12 rounded-md border-2 border-white/80 bg-gradient-to-br from-red-800 to-red-950 shadow sm:w-16"
    aria-label="뒤집힌 카드" />
  <img v-else-if="srcFor(code)" :src="srcFor(code)" :alt="code"
    class="aspect-[5/7] w-12 rounded-md bg-white shadow sm:w-16" />
  <div v-else class="flex aspect-[5/7] w-12 items-center justify-center rounded-md bg-white text-xs font-bold text-black shadow sm:w-16">
    {{ code }}
  </div>
</template>
```

- [ ] **Step 3: 빌드 검증 및 Commit**

Run: `npm --prefix client run build`
Expected: 성공 (SVG 번들 포함)

```bash
git add client/src/assets/cards client/src/components/CardImg.vue
git commit -m "feat: playing-cards-assets SVG 도입 및 CardImg 컴포넌트"
```

---

### Task 8: 클라 — 로비 테이블 목록 · 관리자 테이블/규칙 화면

**Files:**
- Create: `client/src/views/admin/AdminTablesView.vue`, `client/src/views/admin/AdminSettingsView.vue`, `client/src/components/TableList.vue`
- Modify: `client/src/views/LobbyView.vue`, `client/src/views/admin/AdminView.vue` (탭 추가), `client/src/router/index.js`, `client/src/composables/useSocket.js`

**Interfaces:**
- Consumes: `GET /api/tables`, 관리자 테이블/설정 API, 소켓 `tables:update`
- Produces:
  - `useSocket.js`에 `onTablesUpdate(fn)` 리스너 (기존 패턴) + `connectSocket`에서 `socket.on('tables:update', ...)` 등록
  - `TableList` — props `game`, 해당 게임의 open 테이블 카드(이름·인원 `n/7`·한도) → 클릭 시 `/{game}/{tableId}` 이동. open 테이블이 없으면 "관리자가 테이블을 준비 중입니다" 표시. `tables:update` 실시간 반영
  - `LobbyView` — 게임 카드 아래에 게임별 `TableList` 표시 (블랙잭만 링크 활성, 룰렛·바카라는 플랜 5 전까지 "준비 중" 유지)
  - `AdminTablesView` — 생성 폼(게임 셀렉트·이름·한도 선택), 목록(인원·상태), 수정(이름·한도)·닫기/열기·삭제(확인창)
  - `AdminSettingsView` — 그룹 셀렉트(economy/slots/blackjack…) → 키별 입력 자동 렌더(불리언=체크박스, 숫자=number), 한국어 라벨 사전(`SETTING_LABELS`), 저장 시 "다음 라운드부터 적용됩니다" 안내
  - 라우트: `/admin/tables`, `/admin/settings`, `/blackjack/:tableId`

- [ ] **Step 1: useSocket 리스너 추가**

`client/src/composables/useSocket.js` — 기존 패턴대로:
```js
const tablesListeners = new Set()
export function onTablesUpdate(fn) {
  tablesListeners.add(fn)
  return () => tablesListeners.delete(fn)
}
```
`connectSocket` 내부에 추가:
```js
  socket.on('tables:update', (p) => tablesListeners.forEach((fn) => fn(p)))
```

- [ ] **Step 2: TableList + 로비 통합**

`client/src/components/TableList.vue`:
```vue
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { onTablesUpdate } from '../composables/useSocket'

const props = defineProps({ game: { type: String, required: true } })
const all = ref([])
let off

const tables = computed(() => all.value.filter((t) => t.game === props.game && t.status === 'open'))

onMounted(async () => {
  all.value = (await api('/tables')).tables
  off = onTablesUpdate(({ tables: t }) => (all.value = t))
})
onUnmounted(() => off?.())
</script>

<template>
  <div class="mt-2 space-y-1">
    <p v-if="tables.length === 0" class="text-xs text-emerald-500">관리자가 테이블을 준비 중입니다.</p>
    <RouterLink v-for="t in tables" :key="t.id" :to="`/${game}/${t.id}`"
      class="flex items-center justify-between rounded-lg bg-emerald-950/60 px-3 py-2 text-xs hover:bg-emerald-800/60">
      <span class="font-bold text-emerald-100">{{ t.name }}</span>
      <span class="text-emerald-400">
        👥 {{ t.playerCount }}<template v-if="t.limits"> · {{ t.limits.minBet }}~{{ t.limits.maxBet }}칩</template>
      </span>
    </RouterLink>
  </div>
</template>
```

`client/src/views/LobbyView.vue` — 게임 카드 구조 변경: games 배열을
```js
const games = [
  { key: 'blackjack', name: '블랙잭', emoji: '🃏', desc: '딜러를 이겨라 (7석 라이브 테이블)', tables: true },
  { key: 'roulette', name: '룰렛', emoji: '🎡', desc: '유러피언 룰렛 라이브 테이블', tables: false },
  { key: 'baccarat', name: '바카라', emoji: '🀄', desc: '플레이어 vs 뱅커', tables: false },
  { key: 'slots', name: '슬롯머신', emoji: '🎰', desc: '프로그레시브 잭팟에 도전', to: '/slots' },
]
```
로 바꾸고, 카드 템플릿에서 `g.tables`면 카드 하단에 `<TableList :game="g.key" />`를 렌더( `tables: false`면 기존 "준비 중" 배지 유지).

- [ ] **Step 3: AdminTablesView**

`client/src/views/admin/AdminTablesView.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../../lib/api'
import { onTablesUpdate } from '../../composables/useSocket'

const tables = ref([])
const form = ref({ game: 'blackjack', name: '', useLimits: false, minBet: 100, maxBet: 5000 })
const msg = ref('')
let off

async function load() {
  tables.value = (await api('/tables')).tables
}

async function create() {
  msg.value = ''
  try {
    const body = { game: form.value.game, name: form.value.name }
    if (form.value.useLimits) body.limits = { minBet: Number(form.value.minBet), maxBet: Number(form.value.maxBet) }
    await api('/admin/tables', { method: 'POST', body })
    form.value.name = ''
    await load()
    msg.value = '테이블이 생성되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

async function act(id, path, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return
  msg.value = ''
  try {
    if (path === 'delete') await api(`/admin/tables/${id}`, { method: 'DELETE' })
    else await api(`/admin/tables/${id}/${path}`, { method: 'POST' })
    await load()
  } catch (e) {
    msg.value = e.message
  }
}

onMounted(() => {
  load()
  off = onTablesUpdate(({ tables: t }) => (tables.value = t))
})
onUnmounted(() => off?.())
</script>

<template>
  <div class="space-y-4">
    <form class="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="create">
      <div>
        <label class="block text-xs text-emerald-300" for="game">게임</label>
        <select id="game" v-model="form.game" class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm">
          <option value="blackjack">블랙잭</option>
          <option value="roulette">룰렛</option>
          <option value="baccarat">바카라</option>
        </select>
      </div>
      <div class="grow">
        <label class="block text-xs text-emerald-300" for="name">테이블 이름</label>
        <input id="name" v-model="form.name" class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
      </div>
      <label class="flex items-center gap-1 pb-1.5 text-xs text-emerald-300">
        <input v-model="form.useLimits" type="checkbox" class="accent-amber-500" /> 한도 지정
      </label>
      <template v-if="form.useLimits">
        <input v-model="form.minBet" type="number" class="w-24 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" placeholder="최소" />
        <input v-model="form.maxBet" type="number" class="w-24 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" placeholder="최대" />
      </template>
      <button class="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-bold text-emerald-950 hover:bg-amber-400">생성</button>
    </form>
    <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>

    <div class="overflow-x-auto rounded-xl border border-emerald-800">
      <table class="w-full min-w-[560px] text-sm">
        <thead class="bg-emerald-900/60 text-left text-emerald-300">
          <tr><th class="p-2">게임</th><th class="p-2">이름</th><th class="p-2">인원</th><th class="p-2">한도</th><th class="p-2">상태</th><th class="p-2">동작</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tables" :key="t.id" class="border-t border-emerald-900">
            <td class="p-2">{{ t.game }}</td>
            <td class="p-2 font-bold">{{ t.name }}</td>
            <td class="p-2">{{ t.playerCount }}</td>
            <td class="p-2">{{ t.limits ? `${t.limits.minBet}~${t.limits.maxBet}` : '전역 설정' }}</td>
            <td class="p-2">
              <span :class="t.status === 'open' ? 'text-emerald-400' : 'text-red-400'">{{ t.status === 'open' ? '운영 중' : '닫힘' }}</span>
            </td>
            <td class="flex gap-2 p-2 text-xs">
              <button v-if="t.status === 'open'" class="text-orange-400 hover:underline"
                @click="act(t.id, 'close', '테이블을 닫을까요? 진행 중 베팅은 환불됩니다.')">닫기</button>
              <button v-else class="text-emerald-300 hover:underline" @click="act(t.id, 'reopen')">열기</button>
              <button class="text-red-400 hover:underline"
                @click="act(t.id, 'delete', '테이블을 삭제할까요? 진행 중 베팅은 환불됩니다.')">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
```

- [ ] **Step 4: AdminSettingsView**

`client/src/views/admin/AdminSettingsView.vue`:
```vue
<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../../lib/api'

const GROUPS = [
  { key: 'economy', label: '이코노미' },
  { key: 'slots', label: '슬롯머신' },
  { key: 'blackjack', label: '블랙잭' },
]

const SETTING_LABELS = {
  signupBonus: '가입 지급 칩', dailyBonus: '일일 출석 보너스', reliefAmount: '파산 구제액',
  reliefThreshold: '구제 기준 잔액(미만)', reliefCooldownMin: '구제 쿨다운(분)',
  minBet: '최소 베팅', maxBet: '최대 베팅', betStep: '베팅 단위',
  jackpotRate: '잭팟 적립률(0~0.2)', jackpotSeed: '잭팟 시드 금액',
  decks: '슈 덱 수(1~8)', hitSoft17: '딜러 소프트17 히트', surrenderAllowed: '서렌더 허용',
  doubleAllowed: '더블 허용', splitAllowed: '스플릿 허용', blackjackPayout: '블랙잭 배당(1.5=3:2, 1.2=6:5)',
  betSeconds: '베팅 시간(초)', turnSeconds: '턴 시간(초)',
  spinSeconds: '스핀 연출 시간(초)', tiePayout: '타이 배당', pairPayout: '페어 배당',
}

const group = ref('blackjack')
const settings = ref(null)
const msg = ref('')

async function load() {
  msg.value = ''
  settings.value = (await api(`/admin/settings/${group.value}`)).settings
}

async function save() {
  msg.value = ''
  try {
    const res = await api(`/admin/settings/${group.value}`, { method: 'PUT', body: settings.value })
    settings.value = res.settings
    msg.value = '저장되었습니다. 진행 중인 라운드에는 영향이 없고 다음 라운드부터 적용됩니다.'
  } catch (e) {
    msg.value = e.message
  }
}

watch(group, load)
onMounted(load)
</script>

<template>
  <div class="max-w-xl space-y-4">
    <div class="flex items-center gap-2">
      <label class="text-sm text-emerald-300" for="group">설정 그룹</label>
      <select id="group" v-model="group" class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm">
        <option v-for="g in GROUPS" :key="g.key" :value="g.key">{{ g.label }}</option>
      </select>
    </div>

    <form v-if="settings" class="space-y-3 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="save">
      <div v-for="(value, key) in settings" :key="key" class="flex items-center justify-between gap-3">
        <label :for="key" class="text-sm text-emerald-200">{{ SETTING_LABELS[key] ?? key }}</label>
        <input v-if="typeof value === 'boolean'" :id="key" v-model="settings[key]" type="checkbox" class="h-4 w-4 accent-amber-500" />
        <input v-else :id="key" v-model.number="settings[key]" type="number" step="any"
          class="w-32 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-right text-sm" />
      </div>
      <button class="w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-emerald-950 hover:bg-amber-400">저장</button>
      <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>
    </form>
  </div>
</template>
```

- [ ] **Step 5: 라우트·탭 추가**

`client/src/views/admin/AdminView.vue`의 tabs 배열에 추가:
```js
  { to: '/admin/tables', label: '테이블 관리' },
  { to: '/admin/settings', label: '게임 규칙' },
```

`client/src/router/index.js` — admin children에 추가:
```js
      { path: 'tables', component: () => import('../views/admin/AdminTablesView.vue') },
      { path: 'settings', component: () => import('../views/admin/AdminSettingsView.vue') },
```
routes 배열에 추가:
```js
  { path: '/blackjack/:tableId', component: () => import('../views/BlackjackView.vue'), meta: { requiresAuth: true } },
```

- [ ] **Step 6: 빌드 검증 및 Commit (BlackjackView는 Task 9에서 — 빌드는 Task 9 후에 확인)**

```bash
git add client/src
git commit -m "feat: 로비 테이블 목록·관리자 테이블/규칙 설정 화면"
```

---

### Task 9: 클라 — 블랙잭 테이블 화면

**Files:**
- Create: `client/src/views/BlackjackView.vue`, `client/src/components/PhaseTimer.vue`, `client/src/composables/useGameSocket.js`

**Interfaces:**
- Consumes: `/blackjack` 네임스페이스 소켓 이벤트(Task 6), `CardImg`, `useSound`, `useAuthStore`
- Produces:
  - `useGameSocket(gameKey) → { connect(tableId) → Promise<state>, emitAck(event, payload) → Promise<res>, onState(fn), disconnect() }` — `io('/'+gameKey, { auth })` 연결·`table:join`·`table:state` 구독·`table:closed` 시 알림 후 로비 이동 (플랜 5의 룰렛·바카라 뷰도 재사용)
  - `PhaseTimer` — props `endsAt`(epoch ms), 남은 초 + 진행 바 렌더, 3초 이하일 때 `sfx.countdown()` 1회/초
  - `BlackjackView` — 딜러 영역(카드·합), 7좌석 그리드(빈 좌석 = "앉기" 버튼), 내 좌석: 베팅 페이즈에 칩 버튼(100/500/1000/5000, 한도 클램프)+베팅 확정, 내 턴에 히트/스탠드/더블/스플릿/서렌더(규칙·상태에 따라 비활성), 결과 오버레이(핸드별 outcome 한국어: 블랙잭!/승리/무승부/패배/버스트/서렌더), 좌석 떠나기·로비로 버튼. 사운드: 카드 딜 `sfx.deal()`(카드 수 증가 감지), 칩 `sfx.chip()`, 결과 `sfx.win()/sfx.lose()`

- [ ] **Step 1: useGameSocket 구현**

`client/src/composables/useGameSocket.js`:
```js
import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

export function useGameSocket(gameKey) {
  const auth = useAuthStore()
  let socket = null
  const stateListeners = new Set()

  function connect(tableId) {
    socket = io(`/${gameKey}`, { auth: { token: auth.token } })
    socket.on('table:state', (s) => stateListeners.forEach((fn) => fn(s)))
    socket.on('table:closed', () => {
      alert('관리자가 테이블을 닫았습니다. 베팅은 환불되었습니다.')
      router.push('/')
    })
    return new Promise((resolve, reject) => {
      socket.on('connect', async () => {
        const res = await socket.emitWithAck('table:join', { tableId: Number(tableId) })
        if (res.error) {
          alert(res.error)
          router.push('/')
          return reject(new Error(res.error))
        }
        resolve(res.state)
      })
      socket.on('connect_error', (e) => reject(e))
    })
  }

  function emitAck(event, payload = {}) {
    return socket.emitWithAck(event, payload)
  }

  function onState(fn) {
    stateListeners.add(fn)
    return () => stateListeners.delete(fn)
  }

  function disconnect() {
    socket?.close()
    socket = null
  }

  return { connect, emitAck, onState, disconnect }
}
```

- [ ] **Step 2: PhaseTimer 구현**

`client/src/components/PhaseTimer.vue`:
```vue
<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useSound } from '../composables/useSound'

const props = defineProps({ endsAt: { type: Number, default: null }, totalSeconds: { type: Number, default: 20 } })
const { sfx } = useSound()
const remaining = ref(0)
let interval, lastBeep = -1

function tick() {
  remaining.value = props.endsAt ? Math.max(0, Math.ceil((props.endsAt - Date.now()) / 1000)) : 0
  if (remaining.value > 0 && remaining.value <= 3 && remaining.value !== lastBeep) {
    lastBeep = remaining.value
    sfx.countdown()
  }
}

watch(() => props.endsAt, () => {
  clearInterval(interval)
  lastBeep = -1
  if (props.endsAt) {
    tick()
    interval = setInterval(tick, 250)
  }
}, { immediate: true })
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <div v-if="endsAt" class="w-full">
    <div class="h-1.5 w-full overflow-hidden rounded bg-emerald-950">
      <div class="h-full bg-amber-400 transition-all"
        :style="{ width: `${Math.min(100, (remaining / totalSeconds) * 100)}%` }" />
    </div>
    <p class="mt-0.5 text-center text-xs tabular-nums text-amber-300">{{ remaining }}초</p>
  </div>
</template>
```

- [ ] **Step 3: BlackjackView 구현**

`client/src/views/BlackjackView.vue`:
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
const game = useGameSocket('blackjack')

const state = ref(null)
const error = ref('')
const betAmount = ref(0)
const CHIPS = [100, 500, 1000, 5000]

const mySeatIdx = computed(() => state.value?.seats.findIndex((s) => s?.userId === auth.user?.id) ?? -1)
const mySeat = computed(() => (mySeatIdx.value >= 0 ? state.value.seats[mySeatIdx.value] : null))
const isMyTurn = computed(() => state.value?.phase === 'acting' && state.value.currentSeat === mySeatIdx.value)
const myHand = computed(() => (isMyTurn.value ? mySeat.value.hands[mySeat.value.activeHand] : null))

const PHASE_LABELS = {
  waiting: '플레이어를 기다리는 중', betting: '베팅하세요!', acting: '플레이 진행 중',
  dealer: '딜러 차례', result: '결과 발표',
}
const OUTCOME_LABELS = {
  blackjack: '블랙잭!', win: '승리', push: '무승부', lose: '패배', bust: '버스트', surrender: '서렌더',
}

let prevCardCount = 0
function totalCards(s) {
  return s.dealer.cards.length + s.seats.reduce((n, seat) => n + (seat?.hands.reduce((m, h) => m + h.cards.length, 0) ?? 0), 0)
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
    prevCardCount = totalCards(state.value)
  } catch {
    return
  }
  game.onState((s) => {
    const count = totalCards(s)
    if (count > prevCardCount) sfx.deal()
    prevCardCount = count
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const mine = s.seats.find((seat) => seat?.userId === auth.user?.id)
      const won = mine?.hands.some((h) => h.result && h.result.payout > (h.doubled ? mine.bet * 2 : mine.bet) - 1 && h.result.outcome !== 'push')
      if (mine?.bet > 0) (won ? sfx.win() : sfx.lose())
    }
    state.value = s
  })
})
onUnmounted(() => game.disconnect())

async function act(event, payload) {
  error.value = ''
  const res = await game.emitAck(event, payload)
  if (res.error) error.value = res.error
  return res
}

function sit(seatIdx) {
  sfx.click()
  act('seat:join', { seat: seatIdx })
}
async function leaveSeat() {
  sfx.click()
  await act('seat:leave')
}
function addChip(v) {
  sfx.chip()
  const { minBet, maxBet } = state.value.rules
  betAmount.value = Math.min(maxBet, betAmount.value + v)
  if (betAmount.value < minBet) betAmount.value = minBet
}
async function confirmBet() {
  const res = await act('bet:place', { amount: betAmount.value })
  if (res.ok) betAmount.value = 0
}
function doAction(move) {
  sfx.click()
  act('action', { move })
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🃏 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-200">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">베팅 {{ state.rules.minBet.toLocaleString() }}~{{ state.rules.maxBet.toLocaleString() }}칩</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt"
      :total-seconds="state.phase === 'betting' ? state.rules.betSeconds : state.rules.turnSeconds" />

    <!-- 딜러 -->
    <section class="rounded-2xl border border-amber-500/20 bg-emerald-900/50 p-4 text-center">
      <p class="mb-2 text-xs text-emerald-300">딜러 <b v-if="state.dealer.total" class="text-amber-300">{{ state.dealer.total }}</b></p>
      <div class="flex justify-center gap-1.5">
        <CardImg v-for="(card, i) in state.dealer.cards" :key="i" :code="card.code" />
        <p v-if="state.dealer.cards.length === 0" class="text-sm text-emerald-500">대기 중</p>
      </div>
    </section>

    <!-- 좌석 -->
    <section class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <div v-for="(seat, i) in state.seats" :key="i"
        class="rounded-xl border p-2 text-center"
        :class="state.currentSeat === i ? 'border-amber-400 bg-amber-500/10' : 'border-emerald-800 bg-emerald-900/40'">
        <template v-if="seat">
          <p class="truncate text-xs font-bold" :class="seat.userId === auth.user?.id ? 'text-amber-300' : 'text-emerald-200'">
            {{ seat.nickname }}</p>
          <p v-if="seat.bet" class="text-xs text-emerald-400">{{ seat.bet.toLocaleString() }}칩</p>
          <div v-for="(hand, hi) in seat.hands" :key="hi" class="mt-1"
            :class="seat.activeHand === hi && state.currentSeat === i ? 'ring-1 ring-amber-400 rounded' : ''">
            <div class="flex flex-wrap justify-center gap-0.5">
              <CardImg v-for="(card, ci) in hand.cards" :key="ci" :code="card.code" class="!w-8 sm:!w-10" />
            </div>
            <p class="text-xs text-emerald-300">{{ hand.total }}<span v-if="hand.soft"> (소프트)</span></p>
            <p v-if="hand.result" class="text-xs font-bold"
              :class="hand.result.payout > 0 ? 'text-amber-300' : 'text-red-400'">
              {{ OUTCOME_LABELS[hand.result.outcome] }}
              <template v-if="hand.result.payout > 0"> +{{ hand.result.payout.toLocaleString() }}</template>
            </p>
          </div>
          <button v-if="seat.userId === auth.user?.id" class="mt-1 text-xs text-red-400 hover:underline" @click="leaveSeat">
            떠나기</button>
        </template>
        <button v-else class="w-full py-3 text-xs text-emerald-500 hover:text-amber-300" @click="sit(i)">+ 앉기</button>
      </div>
    </section>

    <!-- 조작 -->
    <section v-if="mySeat" class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div v-if="state.phase === 'betting' && mySeat.bet === 0" class="flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v" class="rounded-full border-2 border-amber-400/60 bg-emerald-950 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-emerald-800"
          @click="addChip(v)">{{ v.toLocaleString() }}</button>
        <span class="ml-2 font-bold tabular-nums text-amber-300">{{ betAmount.toLocaleString() }}칩</span>
        <button class="rounded-lg px-2 py-1 text-xs text-emerald-400 hover:text-red-400" @click="betAmount = 0">지우기</button>
        <button :disabled="betAmount === 0"
          class="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
          @click="confirmBet">베팅 확정</button>
      </div>
      <div v-else-if="isMyTurn && myHand" class="flex flex-wrap justify-center gap-2">
        <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500" @click="doAction('hit')">히트</button>
        <button class="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold hover:bg-emerald-700" @click="doAction('stand')">스탠드</button>
        <button v-if="state.rules.doubleAllowed && myHand.cards.length === 2"
          class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold hover:bg-amber-500" @click="doAction('double')">더블</button>
        <button v-if="state.rules.splitAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2 && myHand.cards[0].code.slice(0, -1) === myHand.cards[1].code.slice(0, -1)"
          class="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold hover:bg-purple-500" @click="doAction('split')">스플릿</button>
        <button v-if="state.rules.surrenderAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2"
          class="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold hover:bg-red-600" @click="doAction('surrender')">서렌더</button>
      </div>
      <p v-else class="text-center text-sm text-emerald-400">{{ PHASE_LABELS[state.phase] }}…</p>
      <p v-if="error" class="mt-2 text-center text-sm text-red-400">{{ error }}</p>
    </section>
    <p v-else class="text-center text-sm text-emerald-400">빈 좌석을 눌러 참가하세요.</p>
  </div>
</template>
```

- [ ] **Step 4: 빌드 검증 및 Commit**

Run: `npm --prefix client run build`
Expected: 성공

```bash
git add client/src
git commit -m "feat: 블랙잭 라이브 테이블 화면"
```

---

### Task 10: 통합 검증 (실제 브라우저, 2개 창 멀티플레이)

- [ ] **Step 1: 서버 테스트**

Run: `npm --prefix server test` → PASS (65 tests)

- [ ] **Step 2: 브라우저 시나리오**

1. admin: 관리자 → 테이블 관리 → "블랙잭 1번" 생성 → 로비 테이블 목록에 즉시 표시(두 창 모두, 새로고침 없이)
2. 유저 A·B 두 창으로 같은 테이블 입장 → 서로의 착석·베팅이 실시간 반영, 인원수가 로비에 반영
3. 한 라운드 풀 플레이: 베팅 타이머 → 딜링(딜 사운드) → A 턴(히트/스탠드) → B 턴 타임아웃 자동 스탠드 → 딜러 공개 → 결과·정산(잔액 즉시 갱신, 승패 사운드)
4. 규칙 반영: admin이 게임 규칙에서 서렌더 OFF 저장 → **다음 라운드부터** 서렌더 버튼이 사라지는지
5. 더블·스플릿(같은 랭크 2장일 때) 동작과 추가 차감 확인
6. 베팅한 채로 A 창 새로고침 → 재입장 시 상태 스냅샷 복구(카드·베팅 보임)
7. admin: 라운드 진행 중 테이블 닫기 → 두 창에 알림 + 로비 이동 + 미정산 베팅 환불 확인(잔액)
8. 모바일 뷰(375px): 좌석 그리드 2열 재배치, 조작 버튼 사용 가능, 가로 스크롤 없음

Expected: 전 항목 통과

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: 플랜 4 완료 (테이블·블랙잭 검증 통과)"
```
