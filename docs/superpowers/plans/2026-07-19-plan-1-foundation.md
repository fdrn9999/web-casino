# 플랜 1/7 — 기반(Foundation) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "베가스" 가상머니 카지노의 기반 — 모노레포 스캐폴딩, SQLite 스키마, 서버 권위 지갑 서비스, JWT 인증(가입/로그인), Socket.IO 잔액 실시간 갱신, 로그인·회원가입·로비 셸 화면 — 을 완성해 "가입 → 로그인 → 로비에서 실시간 잔액 확인"이 동작하게 한다.

**Architecture:** `client/`(Vue 3 + Vite + Tailwind v4 + Pinia + Vue Router) + `server/`(Express 5 + Socket.IO + better-sqlite3) 모노레포. 잔액은 100% 서버 권위이며 모든 변동은 `wallet.applyTransaction` 단일 경로로 DB 트랜잭션 처리 후 소켓으로 푸시된다. 게임·관리자 기능은 후속 플랜(2~6)에서 이 기반 위에 얹는다.

**Tech Stack:** Node 24(ESM), Express 5, Socket.IO 4, better-sqlite3, bcryptjs, jsonwebtoken, Vitest+Supertest / Vue 3, Vite, Tailwind CSS v4(`@tailwindcss/vite`), Pinia, Vue Router 4, socket.io-client

## Global Constraints

- 사이트 이름: **베가스** (헤더 로고 `🎰 베가스`, HTML 타이틀 `베가스 — 가상머니 라이브 카지노`)
- 모든 UI 텍스트·에러 메시지는 한국어. 현금/결제/환전 관련 코드·UI·문구 절대 금지.
- 잔액 변동은 반드시 `applyTransaction`(Task 4) 경유. 클라이언트는 잔액을 계산하지 않고 서버 값만 표시.
- 전 페이지 하단 고정 문구(verbatim): `본 사이트는 가상머니 전용입니다. 실제 도박은 오락이 아닌 손실이며, 중독은 질병입니다.`
- 가상화폐 단위 명칭: **칩**. 가입 지급 10,000칩(설정 가능 구조).
- 반응형: 모바일(~640px)·PC 모두 지원, 가로 스크롤 금지.
- 서버는 ESM(`"type": "module"`). 서버 포트 3000, Vite 개발 포트 5173(프록시로 `/api`, `/socket.io` → 3000).
- 테스트 DB는 `:memory:`, 실 DB는 `server/data/casino.db`(gitignore).
- 커밋은 태스크 단위로 자주. 테스트가 빨간 상태로 커밋 금지.

---

### Task 1: 모노레포 스캐폴딩

**Files:**
- Create: `package.json`(루트), `.gitignore`, `README.md`
- Create: `server/package.json`, `server/.env.example`, `server/src/index.js`(임시)
- Create: `client/`(Vite 스캐폴드), `client/vite.config.js`, `client/src/style.css`, `client/index.html`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `npm run dev`(루트) → 서버(3000)+클라(5173) 동시 기동, Vite 프록시 `/api`·`/socket.io` → `http://localhost:3000`

- [ ] **Step 1: 루트 파일 작성**

`package.json`:
```json
{
  "name": "web-casino-practice",
  "private": true,
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm --prefix server run dev\" \"npm --prefix client run dev\"",
    "test": "npm --prefix server test"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
server/data/
.env
*.local
```

`README.md`:
```markdown
# 베가스 — 가상머니 라이브 카지노 (연습 프로젝트)

현금 결제가 일절 없는 **가상머니 전용** 한국어 라이브 카지노 연습 프로젝트입니다.
도박의 위험성을 알리는 교육 목적을 겸합니다.

## 실행
​```
npm install
npm --prefix server install
npm --prefix client install
npm run dev   # 서버 :3000 + 클라이언트 :5173
​```
접속: http://localhost:5173 (기본 관리자: admin / admin1234 — .env로 변경 가능)
```
(위 README 코드펜스의 제로폭 문자는 실제 파일에서는 일반 ``` 로 작성)

- [ ] **Step 2: 루트 devDependency 설치**

Run: `npm i -D concurrently` (루트에서)
Expected: `package.json`에 concurrently 추가, node_modules 생성

- [ ] **Step 3: 서버 패키지 생성**

`server/package.json`:
```json
{
  "name": "casino-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  }
}
```

Run: `npm --prefix server i express socket.io better-sqlite3 bcryptjs jsonwebtoken dotenv` 그리고 `npm --prefix server i -D vitest supertest`
Expected: 의존성 설치 성공 (better-sqlite3는 Node 24용 프리빌드 바이너리 사용)

`server/.env.example`:
```
PORT=3000
JWT_SECRET=change-me-in-production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin1234
DB_PATH=data/casino.db
```

`server/src/index.js` (임시 — Task 6에서 교체):
```js
import 'dotenv/config'
import express from 'express'

const app = express()
app.get('/api/health', (req, res) => res.json({ ok: true }))
app.listen(process.env.PORT || 3000, () => console.log('server on :3000'))
```

- [ ] **Step 4: 클라이언트 스캐폴드**

Run: `npm create vite@latest client -- --template vue`
Run: `npm --prefix client i` 후 `npm --prefix client i vue-router@4 pinia socket.io-client tailwindcss @tailwindcss/vite`
Expected: `client/` 생성 및 의존성 설치 성공

`client/vite.config.js` (전체 교체):
```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})
```

`client/src/style.css` (전체 교체):
```css
@import "tailwindcss";

body {
  @apply bg-emerald-950 text-emerald-50 antialiased;
}
```

`client/index.html`의 `<title>`을 `베가스 — 가상머니 라이브 카지노`로, `lang="ko"`로 변경.

- [ ] **Step 5: 동작 확인**

Run: `npm run dev` (루트) 후 브라우저에서 `http://localhost:5173` 및 `http://localhost:5173/api/health`
Expected: Vite 기본 페이지 표시, health가 `{"ok":true}` 반환 (프록시 동작 확인). 확인 후 Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: 모노레포 스캐폴딩 (Vue3+Vite+Tailwind / Express+Socket.IO)"
```

---

### Task 2: DB 모듈 (스키마 + 커넥션)

**Files:**
- Create: `server/src/db/index.js`
- Test: `server/test/db.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `createDb(filename = ':memory:') → Database` — 스키마 적용된 better-sqlite3 인스턴스 (테스트용)
  - `getDb() → Database` — 싱글턴, `process.env.DB_PATH || 'data/casino.db'` (data 디렉터리 자동 생성)
  - 테이블: `users`, `transactions`, `tables`, `rounds`, `bets`, `notices`, `game_settings`, `jackpot` (스펙 §3)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/db.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'

describe('db', () => {
  it('모든 테이블이 생성된다', () => {
    const db = createDb(':memory:')
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
    for (const t of ['users', 'transactions', 'tables', 'rounds', 'bets', 'notices', 'game_settings', 'jackpot']) {
      expect(names).toContain(t)
    }
  })

  it('users.username은 유니크 제약이 있다', () => {
    const db = createDb(':memory:')
    const ins = db.prepare("INSERT INTO users (username, password_hash, nickname) VALUES (?, 'h', 'n')")
    ins.run('dup')
    expect(() => ins.run('dup')).toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — `Cannot find module '../src/db/index.js'`

- [ ] **Step 3: 구현**

`server/src/db/index.js`:
```js
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  bankrupt_count INTEGER NOT NULL DEFAULT 0,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  last_daily_bonus_at TEXT,
  last_relief_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  game TEXT,
  ref_round_id INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  limits_json TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  table_id INTEGER REFERENCES tables(id),
  result_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  bet_json TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payout INTEGER
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS game_settings (
  game TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jackpot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pool INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  last_winner_id INTEGER REFERENCES users(id),
  last_won_amount INTEGER,
  last_won_at TEXT
);
`

export function createDb(filename = ':memory:') {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

let instance = null
export function getDb() {
  if (!instance) {
    const file = process.env.DB_PATH || 'data/casino.db'
    fs.mkdirSync(path.dirname(file), { recursive: true })
    instance = createDb(file)
  }
  return instance
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/db server/test/db.test.js
git commit -m "feat: SQLite 스키마 및 DB 모듈"
```

---

### Task 3: 게임 설정 서비스 (기본값 + 저장/조회)

**Files:**
- Create: `server/src/services/settings.js`
- Test: `server/test/settings.test.js`

**Interfaces:**
- Consumes: `createDb` (Task 2)
- Produces:
  - `DEFAULT_SETTINGS` — `{ economy: { signupBonus: 10000, dailyBonus: 1000, reliefAmount: 3000, reliefThreshold: 100, reliefCooldownMin: 5 } }` (후속 플랜에서 blackjack 등 키 추가)
  - `getSettings(db, game) → object` — 기본값 위에 저장값 머지
  - `saveSettings(db, game, partial, updatedBy) → object` — 부분 저장(머지) 후 결과 반환

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/settings.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'
import { getSettings, saveSettings } from '../src/services/settings.js'

describe('settings', () => {
  it('저장된 값이 없으면 기본값을 반환한다', () => {
    const db = createDb()
    expect(getSettings(db, 'economy').signupBonus).toBe(10000)
  })

  it('저장하면 기본값 위에 머지되어 반환된다', () => {
    const db = createDb()
    saveSettings(db, 'economy', { signupBonus: 5000 }, null)
    const s = getSettings(db, 'economy')
    expect(s.signupBonus).toBe(5000)
    expect(s.dailyBonus).toBe(1000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — settings.js 없음

- [ ] **Step 3: 구현**

`server/src/services/settings.js`:
```js
export const DEFAULT_SETTINGS = {
  economy: {
    signupBonus: 10000,
    dailyBonus: 1000,
    reliefAmount: 3000,
    reliefThreshold: 100,
    reliefCooldownMin: 5,
  },
}

export function getSettings(db, game) {
  const row = db.prepare('SELECT settings_json FROM game_settings WHERE game = ?').get(game)
  const saved = row ? JSON.parse(row.settings_json) : {}
  return { ...(DEFAULT_SETTINGS[game] ?? {}), ...saved }
}

export function saveSettings(db, game, partial, updatedBy) {
  const merged = { ...getSettings(db, game), ...partial }
  db.prepare(
    `INSERT INTO game_settings (game, settings_json, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(game) DO UPDATE SET settings_json = excluded.settings_json,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(game, JSON.stringify(merged), updatedBy)
  return merged
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/settings.js server/test/settings.test.js
git commit -m "feat: 게임 설정 서비스 (기본값 머지 저장/조회)"
```

---

### Task 4: 지갑 서비스 (잔액 변동 단일 경로)

**Files:**
- Create: `server/src/services/wallet.js`
- Test: `server/test/wallet.test.js`

**Interfaces:**
- Consumes: `createDb` (Task 2)
- Produces:
  - `applyTransaction(db, { userId, type, amount, game?, refRoundId?, reason? }) → { balanceAfter }`
    - `amount`는 부호 있는 정수(지급 +, 차감 −). 잔액이 음수가 되면 `InsufficientBalanceError` throw, DB 변경 없음.
    - `type`: `signup_bonus | daily_bonus | bankrupt_relief | bet | payout | admin_grant | admin_confiscate | jackpot`
    - `type === 'bet'`이면 `users.total_wagered += |amount|`, `payout|jackpot`이면 `users.total_won += amount`
    - transactions에 1행 기록 후 `walletEvents.emit('balance', { userId, balance })`
  - `walletEvents: EventEmitter` — Task 6에서 소켓 푸시에 사용
  - `class InsufficientBalanceError extends Error` (`message: '칩이 부족합니다.'`)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/wallet.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createDb } from '../src/db/index.js'
import { applyTransaction, walletEvents, InsufficientBalanceError } from '../src/services/wallet.js'

function userDb(balance = 0) {
  const db = createDb()
  db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', ?)").run(balance)
  return db
}

describe('wallet.applyTransaction', () => {
  it('지급 시 잔액이 증가하고 거래가 기록된다', () => {
    const db = userDb(0)
    const { balanceAfter } = applyTransaction(db, { userId: 1, type: 'signup_bonus', amount: 10000 })
    expect(balanceAfter).toBe(10000)
    const tx = db.prepare('SELECT * FROM transactions WHERE user_id = 1').get()
    expect(tx.type).toBe('signup_bonus')
    expect(tx.amount).toBe(10000)
    expect(tx.balance_after).toBe(10000)
  })

  it('잔액 부족이면 throw하고 아무것도 변하지 않는다', () => {
    const db = userDb(500)
    expect(() => applyTransaction(db, { userId: 1, type: 'bet', amount: -1000, game: 'slots' }))
      .toThrow(InsufficientBalanceError)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(500)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
  })

  it('bet은 total_wagered, payout은 total_won에 누적된다', () => {
    const db = userDb(1000)
    applyTransaction(db, { userId: 1, type: 'bet', amount: -300, game: 'slots' })
    applyTransaction(db, { userId: 1, type: 'payout', amount: 600, game: 'slots' })
    const u = db.prepare('SELECT * FROM users WHERE id = 1').get()
    expect(u.total_wagered).toBe(300)
    expect(u.total_won).toBe(600)
    expect(u.balance).toBe(1300)
  })

  it('성공 시 balance 이벤트를 발행한다', () => {
    const db = userDb(0)
    const spy = vi.fn()
    walletEvents.once('balance', spy)
    applyTransaction(db, { userId: 1, type: 'daily_bonus', amount: 1000 })
    expect(spy).toHaveBeenCalledWith({ userId: 1, balance: 1000 })
  })

  it('없는 유저면 throw한다', () => {
    const db = createDb()
    expect(() => applyTransaction(db, { userId: 99, type: 'daily_bonus', amount: 1000 })).toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — wallet.js 없음

- [ ] **Step 3: 구현**

`server/src/services/wallet.js`:
```js
import { EventEmitter } from 'node:events'

export const walletEvents = new EventEmitter()
walletEvents.setMaxListeners(0)

export class InsufficientBalanceError extends Error {
  constructor() {
    super('칩이 부족합니다.')
    this.name = 'InsufficientBalanceError'
  }
}

export function applyTransaction(db, { userId, type, amount, game = null, refRoundId = null, reason = null }) {
  const balanceAfter = db.transaction(() => {
    const user = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(userId)
    if (!user) throw new Error('존재하지 않는 유저입니다.')
    const next = user.balance + amount
    if (next < 0) throw new InsufficientBalanceError()
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId)
    if (type === 'bet') {
      db.prepare('UPDATE users SET total_wagered = total_wagered + ? WHERE id = ?').run(Math.abs(amount), userId)
    }
    if (type === 'payout' || type === 'jackpot') {
      db.prepare('UPDATE users SET total_won = total_won + ? WHERE id = ?').run(amount, userId)
    }
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, balance_after, game, ref_round_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, type, amount, next, game, refRoundId, reason)
    return next
  })()
  walletEvents.emit('balance', { userId, balance: balanceAfter })
  return { balanceAfter }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/wallet.js server/test/wallet.test.js
git commit -m "feat: 서버 권위 지갑 서비스 (원자적 잔액 트랜잭션 + 이벤트)"
```

---

### Task 5: 인증 (JWT 미들웨어 + 가입/로그인 라우트 + 관리자 시드)

**Files:**
- Create: `server/src/middleware/auth.js`, `server/src/routes/auth.js`, `server/src/services/bootstrap.js`, `server/src/app.js`
- Test: `server/test/auth.test.js`

**Interfaces:**
- Consumes: `createDb`, `applyTransaction`, `getSettings`
- Produces:
  - `signToken(user) → string` / `verifyToken(token) → { sub, role }`(실패 시 throw) / `JWT_SECRET`
  - `requireAuth(db) → 미들웨어` — `Authorization: Bearer` 검증, `req.user`에 안전 필드(id, username, nickname, role, balance, banned, ban_reason, bankrupt_count, total_wagered, total_won, created_at) 주입. 차단 유저 403 `{ error: '차단된 계정입니다. 사유: ...' }`
  - `requireAdmin` — `req.user.role !== 'admin'`이면 403 (플랜 2에서 사용)
  - REST: `POST /api/auth/signup {username, password, nickname, agreed}` → 201 `{ token, user }` (시드 칩 지급 포함), `POST /api/auth/login {username, password}` → `{ token, user }`, `GET /api/me` → `{ user }`
  - `ensureAdmin(db)` — admin 역할 유저가 없으면 env(`ADMIN_USERNAME`/`ADMIN_PASSWORD`, 기본 admin/admin1234)로 생성
  - `createApp(db) → Express app` (json 파싱, 라우트 마운트, 404·에러 핸들러)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/auth.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

const SIGNUP = { username: 'tester1', password: 'password1', nickname: '테스터', agreed: true }

describe('auth', () => {
  let db, app
  beforeEach(() => {
    db = createDb()
    app = createApp(db)
  })

  it('가입 시 10000칩과 토큰을 받는다', async () => {
    const res = await request(app).post('/api/auth/signup').send(SIGNUP)
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.balance).toBe(10000)
    expect(res.body.user.nickname).toBe('테스터')
    expect(res.body.user.password_hash).toBeUndefined()
  })

  it('고지 동의 없이는 가입 불가', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...SIGNUP, agreed: false })
    expect(res.status).toBe(400)
  })

  it('중복 아이디는 409', async () => {
    await request(app).post('/api/auth/signup').send(SIGNUP)
    const res = await request(app).post('/api/auth/signup').send({ ...SIGNUP, nickname: '둘째' })
    expect(res.status).toBe(409)
  })

  it('로그인 성공/비밀번호 오류', async () => {
    await request(app).post('/api/auth/signup').send(SIGNUP)
    const ok = await request(app).post('/api/auth/login').send({ username: 'tester1', password: 'password1' })
    expect(ok.status).toBe(200)
    expect(ok.body.token).toBeTruthy()
    const bad = await request(app).post('/api/auth/login').send({ username: 'tester1', password: 'wrongpass' })
    expect(bad.status).toBe(401)
  })

  it('차단 유저는 로그인 거부(403)', async () => {
    await request(app).post('/api/auth/signup').send(SIGNUP)
    db.prepare("UPDATE users SET banned = 1, ban_reason = '악용' WHERE username = 'tester1'").run()
    const res = await request(app).post('/api/auth/login').send({ username: 'tester1', password: 'password1' })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('차단')
  })

  it('GET /api/me는 토큰으로 본인 정보를 준다', async () => {
    const { body } = await request(app).post('/api/auth/signup').send(SIGNUP)
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${body.token}`)
    expect(res.status).toBe(200)
    expect(res.body.user.username).toBe('tester1')
    const noAuth = await request(app).get('/api/me')
    expect(noAuth.status).toBe(401)
  })

  it('ensureAdmin은 관리자 계정을 1회만 생성한다', () => {
    ensureAdmin(db)
    ensureAdmin(db)
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all()
    expect(admins.length).toBe(1)
    expect(admins[0].username).toBe('admin')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — app.js 등 없음

- [ ] **Step 3: 구현**

`server/src/middleware/auth.js`:
```js
import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

const SAFE_USER_SQL = `SELECT id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at FROM users WHERE id = ?`

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

export function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return res.status(401).json({ error: '유효하지 않은 로그인입니다. 다시 로그인해 주세요.' })
    }
    const user = db.prepare(SAFE_USER_SQL).get(payload.sub)
    if (!user) return res.status(401).json({ error: '존재하지 않는 계정입니다.' })
    if (user.banned) return res.status(403).json({ error: `차단된 계정입니다. 사유: ${user.ban_reason || '미기재'}` })
    req.user = user
    next()
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '관리자 전용 기능입니다.' })
  next()
}
```

`server/src/routes/auth.js`:
```js
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { signToken } from '../middleware/auth.js'

const SAFE_FIELDS = `id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at`

export function authRouter(db) {
  const r = Router()

  r.post('/signup', (req, res) => {
    const { username, password, nickname, agreed } = req.body ?? {}
    if (!agreed) return res.status(400).json({ error: '가상머니 전용 안내와 도박 위험성 고지에 동의해야 가입할 수 있습니다.' })
    if (!/^[a-z0-9_]{4,20}$/.test(username ?? '')) {
      return res.status(400).json({ error: '아이디는 4~20자의 영문 소문자·숫자·밑줄만 가능합니다.' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })
    }
    const nick = (nickname ?? '').trim()
    if (!nick || nick.length > 12) return res.status(400).json({ error: '닉네임은 1~12자여야 합니다.' })
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    }
    const hash = bcrypt.hashSync(password, 10)
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)')
      .run(username, hash, nick)
    const { signupBonus } = getSettings(db, 'economy')
    applyTransaction(db, { userId: Number(id), type: 'signup_bonus', amount: signupBonus, reason: '가입 축하 칩' })
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id)
    res.status(201).json({ token: signToken(user), user })
  })

  r.post('/login', (req, res) => {
    const { username, password } = req.body ?? {}
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username ?? '')
    if (!row || !bcrypt.compareSync(password ?? '', row.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })
    }
    if (row.banned) return res.status(403).json({ error: `차단된 계정입니다. 사유: ${row.ban_reason || '미기재'}` })
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(row.id)
    res.json({ token: signToken(user), user })
  })

  return r
}
```

`server/src/services/bootstrap.js`:
```js
import bcrypt from 'bcryptjs'

export function ensureAdmin(db) {
  const existing = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()
  if (existing) return
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin1234'
  db.prepare("INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, '운영자', 'admin')")
    .run(username, bcrypt.hashSync(password, 10))
  console.log(`[bootstrap] 관리자 계정 생성: ${username}`)
}
```

`server/src/app.js`:
```js
import express from 'express'
import { authRouter } from './routes/auth.js'
import { requireAuth } from './middleware/auth.js'

export function createApp(db) {
  const app = express()
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter(db))
  app.get('/api/me', requireAuth(db), (req, res) => res.json({ user: req.user }))

  app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }))
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: '서버 오류가 발생했습니다.' })
  })
  return app
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 16 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src
git add server/test/auth.test.js
git commit -m "feat: JWT 인증(가입/로그인/me) 및 관리자 시드"
```

---

### Task 6: 서버 조립 + Socket.IO 기본 네임스페이스

**Files:**
- Create: `server/src/sockets/index.js`
- Modify: `server/src/index.js` (임시 코드 전체 교체)
- Test: `server/test/socket.test.js`

**Interfaces:**
- Consumes: `createApp`, `getDb`, `ensureAdmin`, `verifyToken`, `walletEvents`
- Produces:
  - `createSocketServer(httpServer, db) → io` — 핸드셰이크 `auth.token` JWT 검증(실패·차단 시 거부), 접속 시 `user:{id}` room 참가
  - 서버 → 클라 이벤트: `balance:update { balance }` (walletEvents 구독)
  - `disconnectUser(io, userId)` — 해당 유저의 모든 소켓 강제 종료 전 `session:banned { reason }` 발송 (플랜 2의 차단 기능에서 사용)
  - `server/src/index.js` — dotenv 로드, `getDb()` + `ensureAdmin`, http 서버에 app+io 결합, `PORT`(기본 3000) listen

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/socket.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { io as ioc } from 'socket.io-client'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer } from '../src/sockets/index.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('socket 기본 네임스페이스', () => {
  let db, httpServer, port, token, userId

  beforeAll(async () => {
    db = createDb()
    const app = createApp(db)
    httpServer = createServer(app)
    createSocketServer(httpServer, db)
    await new Promise((r) => httpServer.listen(0, r))
    port = httpServer.address().port
    const res = await request(app).post('/api/auth/signup')
      .send({ username: 'sockuser', password: 'password1', nickname: '소켓', agreed: true })
    token = res.body.token
    userId = res.body.user.id
  })

  afterAll(() => new Promise((r) => httpServer.close(r)))

  it('유효한 토큰으로 접속되고 balance:update를 받는다', async () => {
    const socket = ioc(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] })
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve)
      socket.on('connect_error', reject)
    })
    const balancePromise = new Promise((r) => socket.once('balance:update', r))
    applyTransaction(db, { userId, type: 'daily_bonus', amount: 1000 })
    const payload = await balancePromise
    expect(payload.balance).toBe(11000)
    socket.close()
  })

  it('토큰 없이 접속하면 거부된다', async () => {
    const socket = ioc(`http://localhost:${port}`, { transports: ['websocket'] })
    const err = await new Promise((r) => socket.on('connect_error', r))
    expect(err).toBeTruthy()
    socket.close()
  })
})
```

Run: `npm --prefix server i -D socket.io-client` (테스트용 클라이언트)

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test`
Expected: FAIL — sockets/index.js 없음

- [ ] **Step 3: 구현**

`server/src/sockets/index.js`:
```js
import { Server } from 'socket.io'
import { verifyToken } from '../middleware/auth.js'
import { walletEvents } from '../services/wallet.js'

export function createSocketServer(httpServer, db) {
  const io = new Server(httpServer)

  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token)
      const user = db.prepare('SELECT id, banned FROM users WHERE id = ?').get(payload.sub)
      if (!user || user.banned) return next(new Error('인증에 실패했습니다.'))
      socket.data.userId = user.id
      next()
    } catch {
      next(new Error('인증에 실패했습니다.'))
    }
  })

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`)
  })

  walletEvents.on('balance', ({ userId, balance }) => {
    io.to(`user:${userId}`).emit('balance:update', { balance })
  })

  return io
}

export function disconnectUser(io, userId, reason = '') {
  io.to(`user:${userId}`).emit('session:banned', { reason })
  io.in(`user:${userId}`).disconnectSockets(true)
}
```

`server/src/index.js` (전체 교체):
```js
import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { getDb } from './db/index.js'
import { ensureAdmin } from './services/bootstrap.js'
import { createSocketServer } from './sockets/index.js'

const db = getDb()
ensureAdmin(db)

const app = createApp(db)
const httpServer = createServer(app)
export const io = createSocketServer(httpServer, db)

const port = process.env.PORT || 3000
httpServer.listen(port, () => console.log(`베가스 서버 기동: http://localhost:${port}`))
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (누적 18 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/socket.test.js server/package.json server/package-lock.json
git commit -m "feat: 서버 조립 및 Socket.IO 잔액 실시간 푸시"
```

---

### Task 7: 클라이언트 인프라 (API 래퍼 · 인증 스토어 · 라우터 · 레이아웃)

**Files:**
- Create: `client/src/lib/api.js`, `client/src/stores/auth.js`, `client/src/router/index.js`
- Modify: `client/src/main.js`, `client/src/App.vue` (스캐폴드 코드 전체 교체)
- Delete: `client/src/components/HelloWorld.vue`, `client/src/assets/vue.svg` 등 Vite 샘플 파일

**Interfaces:**
- Consumes: REST API (Task 5)
- Produces:
  - `api(path, { method, body }) → Promise<data>` — `/api` 프리픽스, 토큰 자동 첨부, 실패 시 `ApiError(message, status)` throw
  - Pinia `useAuthStore`: state `{ token, user }`, getters `isLoggedIn`, `isAdmin`, actions `signup(form)`, `login(form)`, `fetchMe()`, `logout()`, `setBalance(n)` — token은 localStorage `token` 키에 유지
  - 라우터: `/login`(guestOnly), `/register`(guestOnly), `/`(requiresAuth, LobbyView). 가드: 미로그인 → `/login`, 로그인 상태로 guestOnly 접근 → `/`
  - `App.vue` — 헤더(로고 `🎰 베가스`, 잔액 `💰 N 칩`, 닉네임, 로그아웃) + `<RouterView>` + 하단 고정 경고 문구. 모바일에서 헤더 줄바꿈(flex-wrap)

- [ ] **Step 1: 구현**

`client/src/lib/api.js`:
```js
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || '요청에 실패했습니다.', res.status)
  return data
}
```

`client/src/stores/auth.js`:
```js
import { defineStore } from 'pinia'
import { api } from '../lib/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token'),
    user: null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
  },
  actions: {
    _apply({ token, user }) {
      this.token = token
      this.user = user
      localStorage.setItem('token', token)
    },
    async signup(form) {
      this._apply(await api('/auth/signup', { method: 'POST', body: form }))
    },
    async login(form) {
      this._apply(await api('/auth/login', { method: 'POST', body: form }))
    },
    async fetchMe() {
      try {
        const { user } = await api('/me')
        this.user = user
      } catch {
        this.logout()
      }
    },
    logout() {
      this.token = null
      this.user = null
      localStorage.removeItem('token')
    },
    setBalance(balance) {
      if (this.user) this.user.balance = balance
    },
  },
})
```

`client/src/router/index.js`:
```js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
  { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
  { path: '/', component: () => import('../views/LobbyView.vue'), meta: { requiresAuth: true } },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) return '/login'
  if (to.meta.guestOnly && auth.isLoggedIn) return '/'
})
```

`client/src/main.js` (전체 교체):
```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())

const auth = useAuthStore()
if (auth.isLoggedIn) auth.fetchMe()

app.use(router)
app.mount('#app')
```

`client/src/App.vue` (전체 교체):
```vue
<script setup>
import { RouterView, RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const router = useRouter()

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header
      v-if="auth.isLoggedIn"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 bg-emerald-900/80 border-b border-amber-500/30"
    >
      <RouterLink to="/" class="text-lg font-bold text-amber-400">🎰 베가스</RouterLink>
      <div class="ml-auto flex items-center gap-3">
        <span class="rounded-full bg-emerald-800 px-3 py-1 text-sm font-semibold text-amber-200">
          💰 {{ (auth.user?.balance ?? 0).toLocaleString() }} 칩
        </span>
        <span class="text-sm text-emerald-200">{{ auth.user?.nickname }}</span>
        <button class="text-sm text-emerald-300 hover:text-amber-300" @click="logout">로그아웃</button>
      </div>
    </header>

    <main class="flex-1 p-4">
      <RouterView />
    </main>

    <footer class="border-t border-emerald-800 px-4 py-3 text-center text-xs text-emerald-300/70">
      본 사이트는 가상머니 전용입니다. 실제 도박은 오락이 아닌 손실이며, 중독은 질병입니다.
    </footer>
  </div>
</template>
```

Vite 샘플 파일 삭제: `client/src/components/HelloWorld.vue`, `client/src/assets/vue.svg`, `client/public/vite.svg` (index.html의 favicon 참조도 제거).

- [ ] **Step 2: 빌드로 검증**

Run: `npm --prefix client run build`
Expected: 빌드 성공 (LoginView 등 뷰 파일이 아직 없으므로 실패하면 Task 8 이후 재실행 — 실패 시 이 단계는 Task 8 완료 후로 미룬다)

- [ ] **Step 3: Commit**

```bash
git add client
git commit -m "feat: 클라이언트 인프라 (API 래퍼, 인증 스토어, 라우터, 베가스 레이아웃)"
```

---

### Task 8: 로그인 · 회원가입 화면

**Files:**
- Create: `client/src/views/LoginView.vue`, `client/src/views/RegisterView.vue`

**Interfaces:**
- Consumes: `useAuthStore.login/signup`, 라우터
- Produces: `/login`, `/register` 화면 — 성공 시 `/` 이동, 실패 시 서버 에러 메시지 표시

- [ ] **Step 1: 구현**

`client/src/views/LoginView.vue`:
```vue
<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login({ username: username.value, password: password.value })
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-6 shadow-xl">
    <h1 class="mb-1 text-center text-2xl font-bold text-amber-400">🎰 베가스</h1>
    <p class="mb-6 text-center text-xs text-emerald-300">가상머니 전용 라이브 카지노</p>
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="username">아이디</label>
        <input id="username" v-model="username" autocomplete="username"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="password">비밀번호</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button :disabled="loading"
        class="w-full rounded-lg bg-amber-500 py-2 font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-50">
        {{ loading ? '로그인 중...' : '로그인' }}
      </button>
    </form>
    <p class="mt-4 text-center text-sm text-emerald-300">
      계정이 없나요?
      <RouterLink to="/register" class="text-amber-400 hover:underline">회원가입</RouterLink>
    </p>
  </div>
</template>
```

`client/src/views/RegisterView.vue`:
```vue
<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const form = ref({ username: '', password: '', nickname: '', agreed: false })
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.signup(form.value)
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-6 shadow-xl">
    <h1 class="mb-6 text-center text-2xl font-bold text-amber-400">회원가입</h1>
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="username">아이디 (영문 소문자·숫자·_ 4~20자)</label>
        <input id="username" v-model="form.username" autocomplete="username"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="password">비밀번호 (8자 이상)</label>
        <input id="password" v-model="form.password" type="password" autocomplete="new-password"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="nickname">닉네임 (12자 이내)</label>
        <input id="nickname" v-model="form.nickname"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <label class="flex items-start gap-2 text-xs text-emerald-200">
        <input v-model="form.agreed" type="checkbox" class="mt-0.5 accent-amber-500" />
        <span>본 사이트는 <b class="text-amber-300">가상머니 전용</b>이며 현금 거래가 일절 불가능함을 이해했습니다.
        실제 도박은 오락이 아닌 손실이며, 중독은 질병임을 확인했습니다. (필수)</span>
      </label>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button :disabled="loading"
        class="w-full rounded-lg bg-amber-500 py-2 font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-50">
        {{ loading ? '가입 중...' : '가입하고 10,000칩 받기' }}
      </button>
    </form>
    <p class="mt-4 text-center text-sm text-emerald-300">
      이미 계정이 있나요?
      <RouterLink to="/login" class="text-amber-400 hover:underline">로그인</RouterLink>
    </p>
  </div>
</template>
```

- [ ] **Step 2: Commit (빌드 확인은 Task 9에서 LobbyView와 함께)**

```bash
git add client/src/views
git commit -m "feat: 로그인·회원가입 화면 (위험성 고지 동의 포함)"
```

---

### Task 9: 로비 셸 + 소켓 연결(실시간 잔액)

**Files:**
- Create: `client/src/views/LobbyView.vue`, `client/src/composables/useSocket.js`

**Interfaces:**
- Consumes: `useAuthStore`, `balance:update`/`session:banned` 소켓 이벤트 (Task 6)
- Produces:
  - `connectSocket() → socket` / `disconnectSocket()` — 싱글턴 socket.io-client 연결(`auth: { token }`), `balance:update` → `auth.setBalance`, `session:banned` → 로그아웃+`/login?banned=1` 이동. `getSocket()`으로 후속 플랜(게임 네임스페이스는 각자 별도 연결)에서 재사용
  - `LobbyView` — 게임 카드 그리드(블랙잭·룰렛·바카라·슬롯, 전부 "준비 중" 배지 — 후속 플랜에서 교체), 공지·잭팟 위젯 자리(플레이스홀더), 반응형(grid-cols-1 sm:grid-cols-2 lg:grid-cols-4)

- [ ] **Step 1: 구현**

`client/src/composables/useSocket.js`:
```js
import { io } from 'socket.io-client'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

let socket = null

export function connectSocket() {
  if (socket) return socket
  const auth = useAuthStore()
  socket = io({ auth: { token: auth.token } })
  socket.on('balance:update', ({ balance }) => auth.setBalance(balance))
  socket.on('session:banned', () => {
    auth.logout()
    disconnectSocket()
    router.push('/login?banned=1')
  })
  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  socket?.close()
  socket = null
}
```

`client/src/views/LobbyView.vue`:
```vue
<script setup>
import { onMounted } from 'vue'
import { connectSocket } from '../composables/useSocket'

const games = [
  { key: 'blackjack', name: '블랙잭', emoji: '🃏', desc: '딜러를 이겨라 (7석 라이브 테이블)' },
  { key: 'roulette', name: '룰렛', emoji: '🎡', desc: '유러피언 룰렛 라이브 테이블' },
  { key: 'baccarat', name: '바카라', emoji: '🀄', desc: '플레이어 vs 뱅커' },
  { key: 'slots', name: '슬롯머신', emoji: '🎰', desc: '프로그레시브 잭팟에 도전' },
]

onMounted(() => connectSocket())
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm text-emerald-300">
      📢 공지사항 영역 (플랜 2에서 구현)
    </section>

    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="g in games"
        :key="g.key"
        class="rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-5 opacity-80"
      >
        <div class="text-3xl">{{ g.emoji }}</div>
        <h2 class="mt-2 text-lg font-bold text-amber-300">{{ g.name }}</h2>
        <p class="mt-1 text-xs text-emerald-300">{{ g.desc }}</p>
        <span class="mt-3 inline-block rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-300">준비 중</span>
      </div>
    </section>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm text-emerald-300">
      💎 잭팟 위젯 영역 (플랜 3에서 구현)
    </section>
  </div>
</template>
```

- [ ] **Step 2: 빌드 검증**

Run: `npm --prefix client run build`
Expected: 빌드 성공, 에러 없음 (Task 7 Step 2를 미뤘다면 여기서 함께 확인)

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "feat: 로비 셸 및 소켓 실시간 잔액 연동"
```

---

### Task 10: 통합 검증 (실제 브라우저)

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: 플랜 1 전체
- Produces: 동작 확인된 기반. 문제 발견 시 수정 커밋.

- [ ] **Step 1: 서버 테스트 전체 통과 확인**

Run: `npm --prefix server test`
Expected: PASS (18 tests)

- [ ] **Step 2: 개발 서버 기동**

Run: `npm run dev`
Expected: 서버 `베가스 서버 기동: http://localhost:3000` + `[bootstrap] 관리자 계정 생성: admin` 출력, Vite 5173 기동

- [ ] **Step 3: 브라우저 검증 (실제 렌더 관찰 — 정적 확인으로 대체 금지)**

체크리스트 (`http://localhost:5173`):
1. 미로그인 접속 → `/login`으로 리다이렉트되는가
2. 회원가입: 동의 체크 없이 제출 → 한국어 에러 표시 / 체크 후 가입 → 로비 이동, 헤더에 `💰 10,000 칩`
3. 새로고침 → 로그인 유지(fetchMe), 로비 표시
4. 로그아웃 → `/login` 이동, 뒤로가기로 로비 접근 불가
5. admin/admin1234 로그인 성공
6. 하단 경고 문구가 모든 화면에 보이는가
7. 개발자도구 모바일 뷰(375px) → 헤더 줄바꿈 정상, 가로 스크롤 없음
8. (실시간 확인) 로비를 띄운 채 다음을 실행해 잔액이 새로고침 없이 바뀌는지 확인:
   서버 디렉터리에서 `node -e "import('./src/db/index.js').then(async ({getDb})=>{const {applyTransaction}=await import('./src/services/wallet.js');})"` 방식은 별도 프로세스라 소켓에 반영되지 않으므로, 대신 **가입 직후 잔액 표시**와 플랜 2의 보너스 기능에서 실시간성을 검증한다. 여기서는 소켓 연결 자체(개발자도구 Network → socket.io 101 Switching Protocols)만 확인.

Expected: 전 항목 통과. 실패 항목은 수정 후 재확인.

- [ ] **Step 4: 마무리 Commit**

```bash
git add -A
git commit -m "chore: 플랜 1 기반 완료 (검증 통과)"
```

---

## 후속 플랜 개요 (이 플랜에 포함되지 않음)

- **플랜 2**: 일일 보너스·파산 구제(경고 모달), 관리자 유저 관리(지급/몰수/차단 + 강제 접속 종료), 공지 CRUD + 실시간 배너
- **플랜 3**: 슬롯머신 + 전역 프로그레시브 잭팟 + 사운드 시스템(`jackpot-1.mp3` 복사, Web Audio SE)
- **플랜 4**: 테이블 CRUD + 라운드 루프 프레임워크 + 블랙잭(카드 에셋 도입, 규칙 설정 화면)
- **플랜 5**: 룰렛 + 바카라
- **플랜 6**: 통계 대시보드, 마이페이지 손익, 휴식 알림, 최종 폴리시·검증
