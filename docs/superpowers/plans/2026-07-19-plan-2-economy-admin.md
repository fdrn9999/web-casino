# 플랜 2/7 — 이코노미 · 관리자 유저관리 · 공지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일일 보너스·파산 구제(누적 손실 직면 모달), 관리자 유저 관리(칩 지급/몰수/차단·해제 + 강제 접속 종료), 공지 CRUD + 실시간 배너를 완성한다.

**Architecture:** 플랜 1의 지갑 서비스(`applyTransaction`) 위에 REST 라우트를 얹는다. 라우트가 Socket.IO에 접근해야 하므로 `createApp(db, ctx)`로 시그니처를 확장하고 `ctx.io`를 기동 시 주입한다(순환 참조 회피). 공지 등록·차단은 기본 네임스페이스로 브로드캐스트/강제 종료한다.

**Tech Stack:** 플랜 1과 동일 (신규 의존성 없음)

## Global Constraints

플랜 1의 Global Constraints 전체가 그대로 적용된다. 추가:

- 잔액 변동(보너스·구제·지급·몰수)은 전부 `applyTransaction` 경유 — 직접 UPDATE 금지.
- 관리자 지급/몰수/차단은 **사유(reason) 필수** — 누락 시 400.
- 일일 보너스 기준일은 **KST(UTC+9) 자정**.
- 파산 구제: 잔액 < `reliefThreshold`(기본 100) 이고 마지막 구제로부터 `reliefCooldownMin`(기본 5분) 경과 시에만. 구제 시 `bankrupt_count` +1.
- 관리자 API는 전부 `requireAuth(db)` + `requireAdmin` 이중 가드.

## 플랜 1에서 물려받는 인터페이스 (변경 금지)

- `applyTransaction(db, { userId, type, amount, game?, refRoundId?, reason? }) → { balanceAfter }` / `InsufficientBalanceError`
- `requireAuth(db)`, `requireAdmin`, `signToken`, `verifyToken`
- `createDb`, `getDb`, `getSettings(db, 'economy')`, `saveSettings`
- `disconnectUser(io, userId, reason)` (sockets/index.js)
- 클라: `api(path, opts)`, `ApiError`, `useAuthStore`, `connectSocket()/getSocket()`, `router`

---

### Task 1: `createApp` ctx 확장 + 이코노미 라우트 (일일 보너스 · 파산 구제)

**Files:**
- Create: `server/src/routes/economy.js`, `server/src/lib/time.js`
- Modify: `server/src/app.js` (ctx 파라미터 추가 + 라우트 마운트), `server/src/index.js` (ctx 주입)
- Test: `server/test/economy.test.js`

**Interfaces:**
- Consumes: `applyTransaction`, `getSettings`, `requireAuth`
- Produces:
  - `createApp(db, ctx = {}) → app` — 이후 모든 라우트는 `ctx.io`(기동 후 주입됨)를 요청 시점에 참조
  - `kstDateString(date = new Date()) → 'YYYY-MM-DD'` (`server/src/lib/time.js`)
  - `POST /api/bonus/daily` → 200 `{ balance, amount }` / 409 `{ error: '오늘은 이미 출석 보너스를 받았습니다.' }`
  - `GET /api/relief/status` → `{ eligible, reasonIfNot, cooldownRemainingSec, netLoss, bankruptCount, amount }` (`netLoss = max(0, total_wagered - total_won)`)
  - `POST /api/relief` → 200 `{ balance, amount, bankruptCount }` / 400(잔액 기준 초과) / 429(쿨다운)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/economy.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'

async function signupUser(app, username = 'econ1') {
  const res = await request(app).post('/api/auth/signup')
    .send({ username, password: 'password1', nickname: '이코', agreed: true })
  return { token: res.body.token, id: res.body.user.id }
}

describe('economy', () => {
  let db, app, token, id
  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    ;({ token, id } = await signupUser(app))
  })

  it('일일 보너스는 하루 1회만 지급된다', async () => {
    const ok = await request(app).post('/api/bonus/daily').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)
    expect(ok.body.balance).toBe(11000)
    const dup = await request(app).post('/api/bonus/daily').set('Authorization', `Bearer ${token}`)
    expect(dup.status).toBe(409)
  })

  it('잔액이 기준 이상이면 구제 불가(400)', async () => {
    const res = await request(app).post('/api/relief').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('잔액이 기준 미만이면 구제되고 bankrupt_count가 증가한다', async () => {
    db.prepare('UPDATE users SET balance = 50 WHERE id = ?').run(id)
    const st = await request(app).get('/api/relief/status').set('Authorization', `Bearer ${token}`)
    expect(st.body.eligible).toBe(true)
    const res = await request(app).post('/api/relief').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.balance).toBe(3050)
    expect(res.body.bankruptCount).toBe(1)
  })

  it('구제 직후 재구제는 쿨다운(429)', async () => {
    db.prepare('UPDATE users SET balance = 50 WHERE id = ?').run(id)
    await request(app).post('/api/relief').set('Authorization', `Bearer ${token}`)
    db.prepare('UPDATE users SET balance = 50 WHERE id = ?').run(id)
    const res = await request(app).post('/api/relief').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(429)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — economy.js 없음

- [ ] **Step 3: 구현**

`server/src/lib/time.js`:
```js
export function kstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
```

`server/src/routes/economy.js`:
```js
import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { requireAuth } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

export function economyRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.post('/bonus/daily', (req, res) => {
    const today = kstDateString()
    const row = db.prepare('SELECT last_daily_bonus_at FROM users WHERE id = ?').get(req.user.id)
    if (row.last_daily_bonus_at === today) {
      return res.status(409).json({ error: '오늘은 이미 출석 보너스를 받았습니다.' })
    }
    const { dailyBonus } = getSettings(db, 'economy')
    db.prepare('UPDATE users SET last_daily_bonus_at = ? WHERE id = ?').run(today, req.user.id)
    const { balanceAfter } = applyTransaction(db, {
      userId: req.user.id, type: 'daily_bonus', amount: dailyBonus, reason: `출석 보너스 ${today}`,
    })
    res.json({ balance: balanceAfter, amount: dailyBonus })
  })

  function reliefStatus(db, user) {
    const eco = getSettings(db, 'economy')
    const row = db.prepare('SELECT balance, last_relief_at, bankrupt_count, total_wagered, total_won FROM users WHERE id = ?').get(user.id)
    const netLoss = Math.max(0, row.total_wagered - row.total_won)
    let cooldownRemainingSec = 0
    if (row.last_relief_at) {
      const elapsed = (Date.now() - new Date(row.last_relief_at + 'Z').getTime()) / 1000
      cooldownRemainingSec = Math.max(0, Math.ceil(eco.reliefCooldownMin * 60 - elapsed))
    }
    let reasonIfNot = null
    if (row.balance >= eco.reliefThreshold) reasonIfNot = `잔액이 ${eco.reliefThreshold}칩 이상이면 구제를 받을 수 없습니다.`
    else if (cooldownRemainingSec > 0) reasonIfNot = '쿨다운이 끝나지 않았습니다.'
    return {
      eligible: !reasonIfNot,
      reasonIfNot,
      cooldownRemainingSec,
      netLoss,
      bankruptCount: row.bankrupt_count,
      amount: eco.reliefAmount,
      balance: row.balance,
    }
  }

  r.get('/relief/status', (req, res) => res.json(reliefStatus(db, req.user)))

  r.post('/relief', (req, res) => {
    const st = reliefStatus(db, req.user)
    if (!st.eligible) {
      const code = st.cooldownRemainingSec > 0 && st.balance < getSettings(db, 'economy').reliefThreshold ? 429 : 400
      return res.status(code).json({ error: st.reasonIfNot })
    }
    db.prepare("UPDATE users SET last_relief_at = datetime('now'), bankrupt_count = bankrupt_count + 1 WHERE id = ?")
      .run(req.user.id)
    const { balanceAfter } = applyTransaction(db, {
      userId: req.user.id, type: 'bankrupt_relief', amount: st.amount, reason: '파산 구제',
    })
    res.json({ balance: balanceAfter, amount: st.amount, bankruptCount: st.bankruptCount + 1 })
  })

  return r
}
```

`server/src/app.js` — `createApp(db)`를 `createApp(db, ctx = {})`로 변경하고 마운트 추가:
```js
import express from 'express'
import { authRouter } from './routes/auth.js'
import { economyRouter } from './routes/economy.js'
import { requireAuth } from './middleware/auth.js'

export function createApp(db, ctx = {}) {
  const app = express()
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter(db))
  app.get('/api/me', requireAuth(db), (req, res) => res.json({ user: req.user }))
  app.use('/api', economyRouter(db))

  app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }))
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: '서버 오류가 발생했습니다.' })
  })
  return app
}
```

`server/src/index.js` — ctx 연결 (해당 부분만 변경):
```js
const ctx = {}
const app = createApp(db, ctx)
const httpServer = createServer(app)
ctx.io = createSocketServer(httpServer, db)
export const io = ctx.io
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 22 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/economy.test.js
git commit -m "feat: 일일 보너스·파산 구제 API (KST 기준, 쿨다운)"
```

---

### Task 2: 관리자 유저 관리 API (조회 · 지급 · 몰수 · 차단)

**Files:**
- Create: `server/src/routes/admin-users.js`
- Modify: `server/src/app.js` (마운트: `app.use('/api/admin/users', adminUsersRouter(db, ctx))`)
- Test: `server/test/admin-users.test.js`

**Interfaces:**
- Consumes: `applyTransaction`, `requireAuth`+`requireAdmin`, `disconnectUser`, `ctx.io`
- Produces (모두 `/api/admin/users` 하위, admin 전용):
  - `GET /?q=검색어` → `{ users: [...] }` (안전 필드, username/nickname LIKE 검색, 최신 가입순 100명)
  - `GET /:id` → `{ user, transactions }` (최근 거래 50건)
  - `POST /:id/grant { amount, reason }` → `{ balance }` — amount는 1 이상 정수, reason 필수
  - `POST /:id/confiscate { amount | 'all', reason }` → `{ balance }` — 잔액 초과분은 잔액까지로 클램프
  - `POST /:id/ban { reason }` → `{ ok: true }` — banned=1 저장 후 `disconnectUser(ctx.io, id, reason)` (io 없으면 생략)
  - `POST /:id/unban` → `{ ok: true }`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/admin-users.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

describe('admin users', () => {
  let db, app, adminToken, userToken, userId, disconnected

  beforeEach(async () => {
    db = createDb()
    disconnected = []
    const fakeIo = {
      to: (room) => ({ emit: (ev, p) => disconnected.push({ room, ev, p }) }),
      in: (room) => ({ disconnectSockets: () => disconnected.push({ room, kicked: true }) }),
    }
    app = createApp(db, { io: fakeIo })
    ensureAdmin(db)
    const a = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })
    adminToken = a.body.token
    const u = await request(app).post('/api/auth/signup')
      .send({ username: 'target1', password: 'password1', nickname: '대상', agreed: true })
    userToken = u.body.token
    userId = u.body.user.id
  })

  it('일반 유저는 관리자 API 접근 불가(403)', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${userToken}`)
    expect(res.status).toBe(403)
  })

  it('검색으로 유저 목록을 조회한다', async () => {
    const res = await request(app).get('/api/admin/users?q=target').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.users.map((u) => u.username)).toContain('target1')
    expect(res.body.users[0].password_hash).toBeUndefined()
  })

  it('사유 없이 지급하면 400, 사유가 있으면 지급된다', async () => {
    const noReason = await request(app).post(`/api/admin/users/${userId}/grant`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 500 })
    expect(noReason.status).toBe(400)
    const ok = await request(app).post(`/api/admin/users/${userId}/grant`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 500, reason: '이벤트 보상' })
    expect(ok.status).toBe(200)
    expect(ok.body.balance).toBe(10500)
  })

  it("몰수 'all'은 전액 회수한다", async () => {
    const res = await request(app).post(`/api/admin/users/${userId}/confiscate`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 'all', reason: '악용 적발' })
    expect(res.body.balance).toBe(0)
    const tx = db.prepare("SELECT * FROM transactions WHERE type = 'admin_confiscate'").get()
    expect(tx.amount).toBe(-10000)
    expect(tx.reason).toBe('악용 적발')
  })

  it('차단 시 강제 종료 이벤트가 나가고 로그인이 거부된다', async () => {
    const res = await request(app).post(`/api/admin/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: '욕설' })
    expect(res.status).toBe(200)
    expect(disconnected.some((d) => d.kicked)).toBe(true)
    const login = await request(app).post('/api/auth/login').send({ username: 'target1', password: 'password1' })
    expect(login.status).toBe(403)
    await request(app).post(`/api/admin/users/${userId}/unban`).set('Authorization', `Bearer ${adminToken}`)
    const again = await request(app).post('/api/auth/login').send({ username: 'target1', password: 'password1' })
    expect(again.status).toBe(200)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — admin-users.js 없음

- [ ] **Step 3: 구현**

`server/src/routes/admin-users.js`:
```js
import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { disconnectUser } from '../sockets/index.js'

const SAFE_FIELDS = `id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at`

export function adminUsersRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.get('/', (req, res) => {
    const q = `%${req.query.q ?? ''}%`
    const users = db.prepare(
      `SELECT ${SAFE_FIELDS} FROM users WHERE username LIKE ? OR nickname LIKE ?
       ORDER BY created_at DESC LIMIT 100`
    ).all(q, q)
    res.json({ users })
  })

  r.get('/:id', (req, res) => {
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
    if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' })
    const transactions = db.prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    ).all(user.id)
    res.json({ user, transactions })
  })

  function loadUser(req, res) {
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
    if (!user) res.status(404).json({ error: '유저를 찾을 수 없습니다.' })
    return user
  }

  r.post('/:id/grant', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const { amount, reason } = req.body ?? {}
    if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: '지급액은 1 이상의 정수여야 합니다.' })
    if (!reason?.trim()) return res.status(400).json({ error: '사유를 입력해야 합니다.' })
    const { balanceAfter } = applyTransaction(db, {
      userId: user.id, type: 'admin_grant', amount, reason: reason.trim(),
    })
    res.json({ balance: balanceAfter })
  })

  r.post('/:id/confiscate', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const { amount, reason } = req.body ?? {}
    if (!reason?.trim()) return res.status(400).json({ error: '사유를 입력해야 합니다.' })
    const take = amount === 'all' ? user.balance : amount
    if (!Number.isInteger(take) || take < 1) return res.status(400).json({ error: "몰수액은 1 이상의 정수 또는 'all'이어야 합니다." })
    const clamped = Math.min(take, user.balance)
    if (clamped === 0) return res.json({ balance: user.balance })
    const { balanceAfter } = applyTransaction(db, {
      userId: user.id, type: 'admin_confiscate', amount: -clamped, reason: reason.trim(),
    })
    res.json({ balance: balanceAfter })
  })

  r.post('/:id/ban', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const reason = (req.body?.reason ?? '').trim()
    if (!reason) return res.status(400).json({ error: '차단 사유를 입력해야 합니다.' })
    if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 차단할 수 없습니다.' })
    db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?').run(reason, user.id)
    if (ctx.io) disconnectUser(ctx.io, user.id, reason)
    res.json({ ok: true })
  })

  r.post('/:id/unban', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?').run(user.id)
    res.json({ ok: true })
  })

  return r
}
```

`server/src/app.js`에 마운트 추가 (economyRouter 마운트 위에):
```js
import { adminUsersRouter } from './routes/admin-users.js'
// ...
app.use('/api/admin/users', adminUsersRouter(db, ctx))
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 27 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/admin-users.test.js
git commit -m "feat: 관리자 유저 관리 API (지급·몰수·차단·강제 종료)"
```

---

### Task 3: 공지 API (조회는 전체, CUD는 관리자) + 실시간 푸시

**Files:**
- Create: `server/src/routes/notices.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/notices.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireAdmin`, `ctx.io`
- Produces:
  - `GET /api/notices` (로그인 필요) → `{ notices }` — pinned 우선, 최신순
  - `POST /api/admin/notices { title, body, pinned? }` → 201 `{ notice }` + `ctx.io.emit('notice:new', notice)`
  - `PUT /api/admin/notices/:id { title, body, pinned }` → `{ notice }`
  - `DELETE /api/admin/notices/:id` → `{ ok: true }`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/notices.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

describe('notices', () => {
  let db, app, adminToken, userToken, emitted

  beforeEach(async () => {
    db = createDb()
    emitted = []
    app = createApp(db, { io: { emit: (ev, p) => emitted.push({ ev, p }), to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) } })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
    userToken = (await request(app).post('/api/auth/signup')
      .send({ username: 'reader1', password: 'password1', nickname: '독자', agreed: true })).body.token
  })

  it('관리자가 공지를 생성하면 브로드캐스트되고 유저가 조회할 수 있다', async () => {
    const created = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: '점검 안내', body: '오늘 밤 점검입니다.', pinned: true })
    expect(created.status).toBe(201)
    expect(emitted.some((e) => e.ev === 'notice:new' && e.p.title === '점검 안내')).toBe(true)

    const list = await request(app).get('/api/notices').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.notices[0].title).toBe('점검 안내')
    expect(list.body.notices[0].pinned).toBe(1)
  })

  it('일반 유저는 공지 CUD 불가(403)', async () => {
    const res = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${userToken}`).send({ title: 'x', body: 'y' })
    expect(res.status).toBe(403)
  })

  it('수정과 삭제가 동작한다', async () => {
    const { body } = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${adminToken}`).send({ title: '이벤트', body: '내용' })
    const id = body.notice.id
    const upd = await request(app).put(`/api/admin/notices/${id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ title: '이벤트(수정)', body: '내용2', pinned: false })
    expect(upd.body.notice.title).toBe('이벤트(수정)')
    const del = await request(app).delete(`/api/admin/notices/${id}`).set('Authorization', `Bearer ${adminToken}`)
    expect(del.body.ok).toBe(true)
    const list = await request(app).get('/api/notices').set('Authorization', `Bearer ${adminToken}`)
    expect(list.body.notices.length).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — notices.js 없음

- [ ] **Step 3: 구현**

`server/src/routes/notices.js`:
```js
import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

function getNotice(db, id) {
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(id)
}

export function noticesRouter(db) {
  const r = Router()
  r.get('/', requireAuth(db), (req, res) => {
    const notices = db.prepare('SELECT * FROM notices ORDER BY pinned DESC, id DESC LIMIT 50').all()
    res.json({ notices })
  })
  return r
}

export function adminNoticesRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  function validate(req, res) {
    const { title, body } = req.body ?? {}
    if (!title?.trim() || !body?.trim()) {
      res.status(400).json({ error: '제목과 내용을 모두 입력해야 합니다.' })
      return null
    }
    return { title: title.trim(), body: body.trim(), pinned: req.body.pinned ? 1 : 0 }
  }

  r.post('/', (req, res) => {
    const v = validate(req, res)
    if (!v) return
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO notices (title, body, pinned, created_by) VALUES (?, ?, ?, ?)'
    ).run(v.title, v.body, v.pinned, req.user.id)
    const notice = getNotice(db, id)
    ctx.io?.emit('notice:new', notice)
    res.status(201).json({ notice })
  })

  r.put('/:id', (req, res) => {
    if (!getNotice(db, req.params.id)) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
    const v = validate(req, res)
    if (!v) return
    db.prepare("UPDATE notices SET title = ?, body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(v.title, v.body, v.pinned, req.params.id)
    res.json({ notice: getNotice(db, req.params.id) })
  })

  r.delete('/:id', (req, res) => {
    if (!getNotice(db, req.params.id)) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
    db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  return r
}
```

`server/src/app.js` 마운트 추가:
```js
import { noticesRouter, adminNoticesRouter } from './routes/notices.js'
// ...
app.use('/api/notices', noticesRouter(db))
app.use('/api/admin/notices', adminNoticesRouter(db, ctx))
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 30 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/notices.test.js
git commit -m "feat: 공지 CRUD API 및 실시간 브로드캐스트"
```

---

### Task 4: 클라 — 로비 공지·일일 보너스·파산 구제 모달

**Files:**
- Create: `client/src/components/NoticeBoard.vue`, `client/src/components/ReliefModal.vue`
- Modify: `client/src/views/LobbyView.vue`, `client/src/composables/useSocket.js`

**Interfaces:**
- Consumes: `GET /api/notices`, `POST /api/bonus/daily`, `GET /api/relief/status`, `POST /api/relief`, 소켓 `notice:new`
- Produces:
  - `NoticeBoard` — 고정 공지 상단 강조, 목록 접기/펼치기, `notice:new` 수신 시 목록 갱신 + 상단 토스트 3초
  - `ReliefModal` — props 없음, 로비에서 잔액이 낮으면 노출되는 "파산 구제 신청" 버튼 → 모달: 누적 손실·파산 횟수 경고 문구, 쿨다운 카운트다운, 확인 시 POST
  - 로비에 "출석 보너스 받기" 버튼 (수령 시 비활성 + 금액 토스트)

- [ ] **Step 1: 구현**

`client/src/composables/useSocket.js`의 `connectSocket`에 공지 리스너 훅 추가 — 소켓 생성 직후에 다음 한 줄 추가:
```js
  socket.on('notice:new', (notice) => noticeListeners.forEach((fn) => fn(notice)))
```
파일 상단에 리스너 레지스트리 추가:
```js
const noticeListeners = new Set()
export function onNotice(fn) {
  noticeListeners.add(fn)
  return () => noticeListeners.delete(fn)
}
```

`client/src/components/NoticeBoard.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { onNotice } from '../composables/useSocket'

const notices = ref([])
const toast = ref(null)
const expanded = ref(null)
let off

async function load() {
  notices.value = (await api('/notices')).notices
}

onMounted(() => {
  load()
  off = onNotice((n) => {
    toast.value = n
    setTimeout(() => (toast.value = null), 3000)
    load()
  })
})
onUnmounted(() => off?.())
</script>

<template>
  <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
    <div v-if="toast" class="mb-3 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-emerald-950">
      📢 새 공지: {{ toast.title }}
    </div>
    <h2 class="mb-2 text-sm font-bold text-amber-300">📢 공지사항</h2>
    <p v-if="notices.length === 0" class="text-xs text-emerald-400">등록된 공지가 없습니다.</p>
    <ul class="space-y-1">
      <li v-for="n in notices" :key="n.id">
        <button class="w-full text-left text-sm text-emerald-200 hover:text-amber-300"
          @click="expanded = expanded === n.id ? null : n.id">
          <span v-if="n.pinned" class="mr-1 text-amber-400">📌</span>{{ n.title }}
          <span class="ml-2 text-xs text-emerald-500">{{ n.created_at?.slice(0, 10) }}</span>
        </button>
        <p v-if="expanded === n.id" class="mt-1 whitespace-pre-wrap rounded bg-emerald-950/60 p-2 text-xs text-emerald-300">
          {{ n.body }}
        </p>
      </li>
    </ul>
  </section>
</template>
```

`client/src/components/ReliefModal.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const open = ref(false)
const status = ref(null)
const error = ref('')
const done = ref(false)
let timer

async function refresh() {
  status.value = await api('/relief/status')
}

async function show() {
  error.value = ''
  done.value = false
  await refresh()
  open.value = true
  timer = setInterval(async () => {
    if (status.value?.cooldownRemainingSec > 0) await refresh()
  }, 1000)
}

function close() {
  open.value = false
  clearInterval(timer)
}
onUnmounted(() => clearInterval(timer))

async function claim() {
  error.value = ''
  try {
    const res = await api('/relief', { method: 'POST' })
    auth.setBalance(res.balance)
    done.value = true
  } catch (e) {
    error.value = e.message
  }
}
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @click.self="close">
      <div class="w-full max-w-md rounded-2xl border border-red-500/40 bg-emerald-950 p-6">
        <h2 class="text-lg font-bold text-red-400">⚠️ 파산 구제 신청</h2>
        <div v-if="status" class="mt-4 space-y-2 text-sm text-emerald-200">
          <p>지금까지 <b class="text-red-400">{{ status.netLoss.toLocaleString() }}칩</b>을 잃었고,
            <b class="text-red-400">{{ status.bankruptCount }}번</b> 파산했습니다.</p>
          <p class="rounded bg-red-950/50 p-3 text-xs text-red-300">
            가상머니라도 이 손실 패턴은 실제 도박과 동일합니다. 실제 도박이었다면 이 돈은 돌아오지 않습니다.
            도박은 오락이 아닌 손실이며, 중독은 질병입니다.
          </p>
          <p v-if="status.cooldownRemainingSec > 0" class="text-amber-300">
            쿨다운: {{ status.cooldownRemainingSec }}초 후 신청 가능
          </p>
          <p v-else-if="!status.eligible" class="text-amber-300">{{ status.reasonIfNot }}</p>
        </div>
        <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
        <p v-if="done" class="mt-2 text-sm text-amber-300">{{ status.amount.toLocaleString() }}칩이 지급되었습니다.</p>
        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm text-emerald-300 hover:text-amber-300" @click="close">닫기</button>
          <button v-if="!done" :disabled="!status?.eligible"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40"
            @click="claim">위험을 이해했으며 {{ status?.amount?.toLocaleString() }}칩 구제받기</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

`client/src/views/LobbyView.vue` — 공지 플레이스홀더 섹션을 `<NoticeBoard />`로 교체하고, 상단에 보너스/구제 바 추가. `<script setup>`에 추가:
```js
import { ref } from 'vue'
import NoticeBoard from '../components/NoticeBoard.vue'
import ReliefModal from '../components/ReliefModal.vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const reliefModal = ref(null)
const bonusMsg = ref('')

async function claimDaily() {
  try {
    const res = await api('/bonus/daily', { method: 'POST' })
    auth.setBalance(res.balance)
    bonusMsg.value = `출석 보너스 ${res.amount.toLocaleString()}칩 지급!`
  } catch (e) {
    bonusMsg.value = e.message
  }
  setTimeout(() => (bonusMsg.value = ''), 3000)
}
```
템플릿 — 기존 공지 플레이스홀더 `<section>`을 다음으로 교체:
```html
    <div class="flex flex-wrap items-center gap-2">
      <button class="rounded-lg bg-amber-500/90 px-3 py-1.5 text-sm font-bold text-emerald-950 hover:bg-amber-400"
        @click="claimDaily">🎁 출석 보너스</button>
      <button v-if="(auth.user?.balance ?? 0) < 100"
        class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-500"
        @click="reliefModal.show()">⚠️ 파산 구제 신청</button>
      <span v-if="bonusMsg" class="text-sm text-amber-300">{{ bonusMsg }}</span>
    </div>
    <NoticeBoard />
    <ReliefModal ref="reliefModal" />
```

- [ ] **Step 2: 빌드 검증**

Run: `npm --prefix client run build`
Expected: 빌드 성공

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "feat: 로비 공지·출석 보너스·파산 구제 모달"
```

---

### Task 5: 클라 — 관리자 화면 (레이아웃 · 유저 관리 · 공지 관리)

**Files:**
- Create: `client/src/views/admin/AdminView.vue`, `client/src/views/admin/AdminUsersView.vue`, `client/src/views/admin/AdminNoticesView.vue`
- Modify: `client/src/router/index.js` (admin 라우트+가드), `client/src/App.vue` (관리자 링크)

**Interfaces:**
- Consumes: Task 2·3의 관리자 API, `useAuthStore.isAdmin`
- Produces:
  - 라우트: `/admin` → 리다이렉트 `/admin/users`, `/admin/users`, `/admin/notices` (meta `requiresAdmin`; 가드에서 비관리자는 `/`로)
  - `AdminView` — 탭 내비게이션(유저 관리 | 공지 관리 — 후속 플랜에서 테이블·규칙·통계 탭 추가) + `<RouterView>`
  - `AdminUsersView` — 검색 입력, 유저 테이블(모바일: 컨테이너 내부 가로 스크롤), 행 클릭 시 상세(최근 거래 50건) + 지급/몰수/차단 폼(사유 필수)
  - `AdminNoticesView` — 목록 + 작성/수정 폼(제목·내용·고정 체크) + 삭제(확인창)

- [ ] **Step 1: 라우터·헤더 수정**

`client/src/router/index.js` — routes 배열에 추가:
```js
  {
    path: '/admin',
    component: () => import('../views/admin/AdminView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
    children: [
      { path: '', redirect: '/admin/users' },
      { path: 'users', component: () => import('../views/admin/AdminUsersView.vue') },
      { path: 'notices', component: () => import('../views/admin/AdminNoticesView.vue') },
    ],
  },
```
가드에 추가 (기존 beforeEach 내부):
```js
  if (to.meta.requiresAdmin && !auth.isAdmin) return '/'
```
주의: 새로고침 직후 `auth.user`가 아직 없을 수 있으므로 가드 시작 부분에 다음을 추가:
```js
  if (auth.isLoggedIn && !auth.user) await auth.fetchMe()
```
(beforeEach 콜백을 `async (to) => {...}`로 변경)

`client/src/App.vue` 헤더의 `ml-auto` div 안, 잔액 span 앞에 추가:
```html
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-sm text-amber-300 hover:underline">⚙️ 관리자</RouterLink>
```

- [ ] **Step 2: AdminView 구현**

`client/src/views/admin/AdminView.vue`:
```vue
<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router'
const route = useRoute()
const tabs = [
  { to: '/admin/users', label: '유저 관리' },
  { to: '/admin/notices', label: '공지 관리' },
]
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <h1 class="mb-4 text-xl font-bold text-amber-400">⚙️ 관리자</h1>
    <nav class="mb-4 flex flex-wrap gap-2 border-b border-emerald-800 pb-2">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to"
        class="rounded-lg px-3 py-1.5 text-sm"
        :class="route.path.startsWith(t.to) ? 'bg-amber-500 font-bold text-emerald-950' : 'text-emerald-300 hover:text-amber-300'">
        {{ t.label }}
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
```

- [ ] **Step 3: AdminUsersView 구현**

`client/src/views/admin/AdminUsersView.vue`:
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../../lib/api'

const q = ref('')
const users = ref([])
const detail = ref(null)
const form = ref({ amount: '', reason: '' })
const msg = ref('')

async function search() {
  users.value = (await api(`/admin/users?q=${encodeURIComponent(q.value)}`)).users
}

async function openDetail(id) {
  detail.value = await api(`/admin/users/${id}`)
  form.value = { amount: '', reason: '' }
  msg.value = ''
}

async function act(action, body) {
  msg.value = ''
  try {
    await api(`/admin/users/${detail.value.user.id}/${action}`, { method: 'POST', body })
    msg.value = '처리되었습니다.'
    await openDetail(detail.value.user.id)
    await search()
  } catch (e) {
    msg.value = e.message
  }
}

function grant() { act('grant', { amount: Number(form.value.amount), reason: form.value.reason }) }
function confiscate(all) {
  act('confiscate', { amount: all ? 'all' : Number(form.value.amount), reason: form.value.reason })
}
function ban() {
  if (confirm('이 유저를 차단할까요? 접속 중이면 즉시 종료됩니다.')) act('ban', { reason: form.value.reason })
}

onMounted(search)
</script>

<template>
  <div class="space-y-4">
    <form class="flex gap-2" @submit.prevent="search">
      <input v-model="q" placeholder="아이디/닉네임 검색"
        class="w-full max-w-xs rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm outline-none focus:border-amber-400" />
      <button class="rounded-lg bg-emerald-700 px-4 text-sm hover:bg-emerald-600">검색</button>
    </form>

    <div class="overflow-x-auto rounded-xl border border-emerald-800">
      <table class="w-full min-w-[560px] text-sm">
        <thead class="bg-emerald-900/60 text-left text-emerald-300">
          <tr>
            <th class="p-2">아이디</th><th class="p-2">닉네임</th><th class="p-2">잔액</th>
            <th class="p-2">파산</th><th class="p-2">상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id"
            class="cursor-pointer border-t border-emerald-900 hover:bg-emerald-900/40" @click="openDetail(u.id)">
            <td class="p-2">{{ u.username }}</td>
            <td class="p-2">{{ u.nickname }}</td>
            <td class="p-2">{{ u.balance.toLocaleString() }}칩</td>
            <td class="p-2">{{ u.bankrupt_count }}회</td>
            <td class="p-2">
              <span v-if="u.banned" class="text-red-400">차단됨</span>
              <span v-else-if="u.role === 'admin'" class="text-amber-300">관리자</span>
              <span v-else class="text-emerald-400">정상</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="detail" class="rounded-xl border border-amber-500/30 bg-emerald-900/40 p-4">
      <h2 class="font-bold text-amber-300">{{ detail.user.nickname }} ({{ detail.user.username }})
        — {{ detail.user.balance.toLocaleString() }}칩</h2>
      <p v-if="detail.user.banned" class="mt-1 text-sm text-red-400">차단됨 — 사유: {{ detail.user.ban_reason }}</p>

      <div class="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label class="block text-xs text-emerald-300" for="amount">금액</label>
          <input id="amount" v-model="form.amount" type="number" min="1"
            class="w-28 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
        </div>
        <div class="grow">
          <label class="block text-xs text-emerald-300" for="reason">사유 (필수)</label>
          <input id="reason" v-model="form.reason"
            class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
        </div>
        <button class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold hover:bg-emerald-500" @click="grant">지급</button>
        <button class="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-bold hover:bg-orange-500" @click="confiscate(false)">몰수</button>
        <button class="rounded-lg bg-orange-800 px-3 py-1.5 text-sm font-bold hover:bg-orange-700" @click="confiscate(true)">전액 몰수</button>
        <button v-if="!detail.user.banned" class="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-bold hover:bg-red-600" @click="ban">차단</button>
        <button v-else class="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold hover:bg-emerald-600" @click="act('unban')">차단 해제</button>
      </div>
      <p v-if="msg" class="mt-2 text-sm text-amber-300">{{ msg }}</p>

      <h3 class="mt-4 text-sm font-bold text-emerald-300">최근 거래</h3>
      <div class="mt-1 max-h-60 overflow-y-auto overflow-x-auto rounded border border-emerald-800">
        <table class="w-full min-w-[480px] text-xs">
          <tbody>
            <tr v-for="t in detail.transactions" :key="t.id" class="border-t border-emerald-900">
              <td class="p-1.5 text-emerald-400">{{ t.created_at }}</td>
              <td class="p-1.5">{{ t.type }}</td>
              <td class="p-1.5" :class="t.amount >= 0 ? 'text-emerald-300' : 'text-red-400'">
                {{ t.amount >= 0 ? '+' : '' }}{{ t.amount.toLocaleString() }}</td>
              <td class="p-1.5 text-emerald-400">{{ t.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: AdminNoticesView 구현**

`client/src/views/admin/AdminNoticesView.vue`:
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../../lib/api'

const notices = ref([])
const form = ref({ id: null, title: '', body: '', pinned: false })
const msg = ref('')

async function load() {
  notices.value = (await api('/notices')).notices
}

function edit(n) {
  form.value = { id: n.id, title: n.title, body: n.body, pinned: !!n.pinned }
}
function reset() {
  form.value = { id: null, title: '', body: '', pinned: false }
}

async function save() {
  msg.value = ''
  try {
    const body = { title: form.value.title, body: form.value.body, pinned: form.value.pinned }
    if (form.value.id) await api(`/admin/notices/${form.value.id}`, { method: 'PUT', body })
    else await api('/admin/notices', { method: 'POST', body })
    reset()
    await load()
    msg.value = '저장되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

async function remove(id) {
  if (!confirm('이 공지를 삭제할까요?')) return
  await api(`/admin/notices/${id}`, { method: 'DELETE' })
  await load()
}

onMounted(load)
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <form class="space-y-3 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="save">
      <h2 class="font-bold text-amber-300">{{ form.id ? '공지 수정' : '새 공지 작성' }}</h2>
      <input v-model="form.title" placeholder="제목"
        class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm" />
      <textarea v-model="form.body" rows="5" placeholder="내용"
        class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm"></textarea>
      <label class="flex items-center gap-2 text-sm text-emerald-200">
        <input v-model="form.pinned" type="checkbox" class="accent-amber-500" /> 상단 고정
      </label>
      <div class="flex gap-2">
        <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-amber-400">
          {{ form.id ? '수정' : '등록' }}</button>
        <button v-if="form.id" type="button" class="text-sm text-emerald-300" @click="reset">새로 작성</button>
      </div>
      <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>
    </form>

    <ul class="space-y-2">
      <li v-for="n in notices" :key="n.id" class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-3">
        <div class="flex items-center gap-2">
          <span v-if="n.pinned" class="text-amber-400">📌</span>
          <b class="text-sm">{{ n.title }}</b>
          <span class="ml-auto flex gap-2 text-xs">
            <button class="text-emerald-300 hover:text-amber-300" @click="edit(n)">수정</button>
            <button class="text-red-400 hover:text-red-300" @click="remove(n.id)">삭제</button>
          </span>
        </div>
        <p class="mt-1 whitespace-pre-wrap text-xs text-emerald-300">{{ n.body }}</p>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 5: 빌드 검증 및 Commit**

Run: `npm --prefix client run build`
Expected: 빌드 성공

```bash
git add client/src
git commit -m "feat: 관리자 화면 (유저 관리·공지 관리)"
```

---

### Task 6: 통합 검증 (실제 브라우저, 2개 창)

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 서버 테스트**

Run: `npm --prefix server test`
Expected: PASS (30 tests)

- [ ] **Step 2: 브라우저 시나리오 (`npm run dev` 후, 일반 창 + 시크릿 창)**

1. 일반 창: 일반 유저 로그인 → 출석 보너스 클릭 → 잔액 +1,000 즉시 반영, 재클릭 시 "이미" 에러
2. 시크릿 창: admin 로그인 → 관리자 → 유저 관리에서 해당 유저에게 500칩 지급(사유 입력) → **일반 창 잔액이 새로고침 없이 +500 되는지** (소켓 실시간 검증)
3. admin: 공지 등록(고정) → 일반 창 로비에 토스트 + 목록 반영. 수정·삭제 동작 확인
4. admin: 유저 전액 몰수 → 일반 창 잔액 0 → "파산 구제 신청" 버튼 노출 → 모달에 누적 손실·파산 횟수·경고 문구 표시 → 구제 후 잔액 3,000 → 즉시 재신청 시 쿨다운 표시
5. admin: 유저 차단(사유) → **일반 창이 즉시 로그인 화면으로 이동**하는지, 재로그인 시 사유 포함 403 메시지 확인 → 해제 후 재로그인 성공
6. 일반 유저로 `/admin` 직접 접근 → `/`로 리다이렉트
7. 모바일 뷰(375px): 관리자 유저 테이블이 컨테이너 내부 스크롤로 동작(페이지 가로 스크롤 없음)

Expected: 전 항목 통과. 실패 시 수정 후 재확인.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: 플랜 2 완료 (이코노미·관리자·공지 검증 통과)"
```
