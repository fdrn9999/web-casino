# 플랜 6/6 — 통계 대시보드 · 마이페이지 · 휴식 알림 · 마무리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 통계 대시보드(Chart.js), 유저 마이페이지(본인 손익 직면), 1시간 휴식 권장 알림, 프로덕션 빌드·정적 서빙을 완성하고 전체 제품을 최종 검증한다.

**Architecture:** 통계는 전부 `transactions` 테이블 집계(SQL)로 계산한다 — 별도 집계 테이블 없음(YAGNI). 날짜 버킷은 KST(`date(created_at, '+9 hours')`). 클라 차트는 Chart.js를 얇은 래퍼 컴포넌트로 감싼다.

**Tech Stack:** 기존 + `chart.js` (클라이언트)

## Global Constraints

플랜 1~5의 Global Constraints 전체 적용. 추가:

- 통계 날짜 버킷·"오늘" 판정은 KST 기준.
- 마이페이지는 책임 도박 장치의 일부 — 손실을 완곡하게 표현하지 않는다 (예: "총 -12,000칩 손실").
- 프로덕션 모드: `client/dist`가 있으면 Express가 정적 서빙 + SPA 폴백 (`/api`·`/socket.io` 제외).

## 물려받는 인터페이스 (변경 금지)

- 전체 플랜 1~5 인터페이스. 특히: `transactions` 스키마(type 목록), `requireAuth`/`requireAdmin`, `createApp(db, ctx)`, `kstDateString`, `getJackpot`

---

### Task 1: 통계 API (관리자)

**Files:**
- Create: `server/src/routes/admin-stats.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/admin-stats.test.js`

**Interfaces:**
- Consumes: transactions/users 테이블, `requireAuth`+`requireAdmin`
- Produces: `GET /api/admin/stats?days=7|30|0` (0=전체) → 
  ```
  {
    totals: { users, activeToday, totalWagered, totalPaid, houseNet },
    daily: [{ d: 'YYYY-MM-DD', wagered, paid }],
    byGame: [{ game, wagered, paid, net }],
    reliefDaily: [{ d, count }],
    jackpotHistory: [{ nickname, amount, created_at }] (최근 20),
    topUsers: [{ nickname, username, total_wagered, total_won, net }] (베팅액 상위 10)
  }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/admin-stats.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('admin stats', () => {
  let db, app, adminToken, userId

  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
    const u = await request(app).post('/api/auth/signup')
      .send({ username: 'gambler1', password: 'password1', nickname: '갬블러', agreed: true })
    userId = u.body.user.id
    applyTransaction(db, { userId, type: 'bet', amount: -2000, game: 'slots' })
    applyTransaction(db, { userId, type: 'payout', amount: 500, game: 'slots' })
    applyTransaction(db, { userId, type: 'bet', amount: -1000, game: 'blackjack' })
    applyTransaction(db, { userId, type: 'jackpot', amount: 3000, game: 'slots' })
    db.prepare("UPDATE users SET bankrupt_count = 2 WHERE id = ?").run(userId)
    applyTransaction(db, { userId, type: 'bankrupt_relief', amount: 3000 })
  })

  it('집계가 정확하다', async () => {
    const res = await request(app).get('/api/admin/stats?days=7').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const { totals, byGame, jackpotHistory, topUsers, reliefDaily } = res.body
    expect(totals.users).toBe(2)
    expect(totals.activeToday).toBe(1)
    expect(totals.totalWagered).toBe(3000)
    expect(totals.totalPaid).toBe(3500)
    expect(totals.houseNet).toBe(-500)
    const slots = byGame.find((g) => g.game === 'slots')
    expect(slots).toMatchObject({ wagered: 2000, paid: 3500, net: -1500 })
    expect(jackpotHistory[0]).toMatchObject({ nickname: '갬블러', amount: 3000 })
    expect(topUsers[0].username).toBe('gambler1')
    expect(reliefDaily.reduce((s, r) => s + r.count, 0)).toBe(1)
  })

  it('daily 버킷에 오늘 데이터가 있다', async () => {
    const res = await request(app).get('/api/admin/stats?days=7').set('Authorization', `Bearer ${adminToken}`)
    expect(res.body.daily.length).toBeGreaterThanOrEqual(1)
    expect(res.body.daily.at(-1).wagered).toBe(3000)
  })

  it('일반 유저는 403', async () => {
    const u = await request(app).post('/api/auth/login').send({ username: 'gambler1', password: 'password1' })
    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${u.body.token}`)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/routes/admin-stats.js`:
```js
import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

export function adminStatsRouter(db) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.get('/', (req, res) => {
    const days = Number(req.query.days ?? 30)
    const since = days > 0 ? `-${days} days` : '-100 years'
    const today = kstDateString()

    const totalsRow = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) AS totalWagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) AS totalPaid
      FROM transactions WHERE created_at >= datetime('now', ?)
    `).get(since)

    const totals = {
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      activeToday: db.prepare(
        "SELECT COUNT(DISTINCT user_id) c FROM transactions WHERE date(created_at, '+9 hours') = ?"
      ).get(today).c,
      totalWagered: totalsRow.totalWagered ?? 0,
      totalPaid: totalsRow.totalPaid ?? 0,
      houseNet: (totalsRow.totalWagered ?? 0) - (totalsRow.totalPaid ?? 0),
    }

    const daily = db.prepare(`
      SELECT date(created_at, '+9 hours') d,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid
      FROM transactions
      WHERE type IN ('bet', 'payout', 'jackpot') AND created_at >= datetime('now', ?)
      GROUP BY d ORDER BY d
    `).all(since)

    const byGame = db.prepare(`
      SELECT game,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END)
          - SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) net
      FROM transactions
      WHERE game IS NOT NULL AND created_at >= datetime('now', ?)
      GROUP BY game ORDER BY wagered DESC
    `).all(since)

    const reliefDaily = db.prepare(`
      SELECT date(created_at, '+9 hours') d, COUNT(*) count
      FROM transactions WHERE type = 'bankrupt_relief' AND created_at >= datetime('now', ?)
      GROUP BY d ORDER BY d
    `).all(since)

    const jackpotHistory = db.prepare(`
      SELECT u.nickname, t.amount, t.created_at
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE t.type = 'jackpot' ORDER BY t.id DESC LIMIT 20
    `).all()

    const topUsers = db.prepare(`
      SELECT nickname, username, total_wagered, total_won, total_won - total_wagered AS net
      FROM users WHERE role = 'user' ORDER BY total_wagered DESC LIMIT 10
    `).all()

    res.json({ totals, daily, byGame, reliefDaily, jackpotHistory, topUsers })
  })

  return r
}
```

`server/src/app.js` 마운트 추가:
```js
import { adminStatsRouter } from './routes/admin-stats.js'
// ...
app.use('/api/admin/stats', adminStatsRouter(db))
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 86 tests)

```bash
git add server/src server/test/admin-stats.test.js
git commit -m "feat: 관리자 통계 API (KST 집계)"
```

---

### Task 2: 마이페이지 API (본인 손익)

**Files:**
- Create: `server/src/routes/me-stats.js`
- Modify: `server/src/app.js` (마운트)
- Test: `server/test/me-stats.test.js`

**Interfaces:**
- Produces: `GET /api/me/stats` (로그인 유저 본인) →
  ```
  {
    totals: { totalWagered, totalWon, net, bankruptCount },   // net = totalWon - totalWagered (음수 = 손실)
    daily: [{ d, wagered, paid, net }] (최근 30일),
    recent: [최근 거래 20건 { type, amount, game, reason, created_at }]
  }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/me-stats.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('me stats', () => {
  let db, app, token, userId

  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    const u = await request(app).post('/api/auth/signup')
      .send({ username: 'myself1', password: 'password1', nickname: '본인', agreed: true })
    token = u.body.token
    userId = u.body.user.id
    applyTransaction(db, { userId, type: 'bet', amount: -5000, game: 'roulette' })
    applyTransaction(db, { userId, type: 'payout', amount: 2000, game: 'roulette' })
  })

  it('본인 손익을 숨김없이 반환한다', async () => {
    const res = await request(app).get('/api/me/stats').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.totals).toEqual({ totalWagered: 5000, totalWon: 2000, net: -3000, bankruptCount: 0 })
    expect(res.body.daily.at(-1)).toMatchObject({ wagered: 5000, paid: 2000, net: -3000 })
    expect(res.body.recent.length).toBeGreaterThanOrEqual(3) // 가입 보너스 포함
  })

  it('미로그인은 401', async () => {
    expect((await request(app).get('/api/me/stats')).status).toBe(401)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/routes/me-stats.js`:
```js
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export function meStatsRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/', (req, res) => {
    const u = req.user
    const totals = {
      totalWagered: u.total_wagered,
      totalWon: u.total_won,
      net: u.total_won - u.total_wagered,
      bankruptCount: u.bankrupt_count,
    }
    const daily = db.prepare(`
      SELECT date(created_at, '+9 hours') d,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END)
          - SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) net
      FROM transactions
      WHERE user_id = ? AND type IN ('bet', 'payout', 'jackpot')
        AND created_at >= datetime('now', '-30 days')
      GROUP BY d ORDER BY d
    `).all(u.id)
    const recent = db.prepare(
      'SELECT type, amount, game, reason, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).all(u.id)
    res.json({ totals, daily, recent })
  })

  return r
}
```

`server/src/app.js` 마운트 추가 (`/api/me` GET보다 먼저):
```js
import { meStatsRouter } from './routes/me-stats.js'
// ...
app.use('/api/me/stats', meStatsRouter(db))
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 88 tests)

```bash
git add server/src server/test/me-stats.test.js
git commit -m "feat: 마이페이지 손익 API"
```

---

### Task 3: 클라 — Chart.js 래퍼 + 관리자 통계 대시보드

**Files:**
- Create: `client/src/components/SimpleChart.vue`, `client/src/views/admin/AdminStatsView.vue`
- Modify: `client/src/views/admin/AdminView.vue` (탭), `client/src/router/index.js`

**Interfaces:**
- Consumes: `GET /api/admin/stats`, chart.js
- Produces:
  - `SimpleChart` — props `{ type: 'line'|'bar', labels: string[], datasets: [{ label, data, color }] }`, 다크 테마 기본 옵션, props 변경 시 차트 재생성. 마이페이지에서도 재사용
  - `AdminStatsView` — 기간 필터(7일/30일/전체), 요약 카드 4장(가입자·오늘 활동·총 베팅·하우스 손익), 일별 베팅/지급 라인 차트, 게임별 손익 바 차트, 파산 구제 추이 바 차트, 잭팟 이력 테이블, 베팅 상위 유저 테이블
  - 라우트 `/admin/stats`, 탭 "통계"

- [ ] **Step 1: chart.js 설치**

Run: `npm --prefix client i chart.js`
Expected: 설치 성공

- [ ] **Step 2: SimpleChart 구현**

`client/src/components/SimpleChart.vue`:
```vue
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js/auto'

const props = defineProps({
  type: { type: String, default: 'line' },
  labels: { type: Array, required: true },
  datasets: { type: Array, required: true }, // [{ label, data, color }]
})

const canvas = ref(null)
let chart = null

function render() {
  chart?.destroy()
  chart = new Chart(canvas.value, {
    type: props.type,
    data: {
      labels: props.labels,
      datasets: props.datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color + '80',
        tension: 0.25,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a7f3d0' } } },
      scales: {
        x: { ticks: { color: '#6ee7b7' }, grid: { color: '#064e3b' } },
        y: { ticks: { color: '#6ee7b7' }, grid: { color: '#064e3b' } },
      },
    },
  })
}

watch(() => [props.labels, props.datasets], render, { deep: true })
onMounted(render)
onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="h-64 w-full"><canvas ref="canvas" /></div>
</template>
```

- [ ] **Step 3: AdminStatsView 구현**

`client/src/views/admin/AdminStatsView.vue`:
```vue
<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../../lib/api'
import SimpleChart from '../../components/SimpleChart.vue'

const days = ref(30)
const stats = ref(null)
const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }

async function load() {
  stats.value = await api(`/admin/stats?days=${days.value}`)
}
watch(days, load)
onMounted(load)
</script>

<template>
  <div v-if="stats" class="space-y-6">
    <div class="flex gap-2">
      <button v-for="d in [7, 30, 0]" :key="d"
        class="rounded-lg px-3 py-1.5 text-sm"
        :class="days === d ? 'bg-amber-500 font-bold text-emerald-950' : 'bg-emerald-900 text-emerald-300'"
        @click="days = d">{{ d === 0 ? '전체' : `${d}일` }}</button>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">총 가입자</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.users.toLocaleString() }}</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">오늘 활동 유저</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.activeToday.toLocaleString() }}</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">총 베팅액</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.totalWagered.toLocaleString() }}칩</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">하우스 손익</p>
        <p class="text-2xl font-black" :class="stats.totals.houseNet >= 0 ? 'text-amber-300' : 'text-red-400'">
          {{ stats.totals.houseNet.toLocaleString() }}칩</p>
      </div>
    </div>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">일별 베팅·지급 추이</h2>
      <SimpleChart type="line" :labels="stats.daily.map((r) => r.d)" :datasets="[
        { label: '베팅', data: stats.daily.map((r) => r.wagered), color: '#f59e0b' },
        { label: '지급', data: stats.daily.map((r) => r.paid), color: '#34d399' },
      ]" />
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">게임별 하우스 손익</h2>
        <SimpleChart type="bar" :labels="stats.byGame.map((g) => GAME_LABELS[g.game] ?? g.game)" :datasets="[
          { label: '하우스 손익', data: stats.byGame.map((g) => g.net), color: '#f59e0b' },
        ]" />
      </section>
      <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">파산 구제 추이</h2>
        <SimpleChart type="bar" :labels="stats.reliefDaily.map((r) => r.d)" :datasets="[
          { label: '구제 횟수', data: stats.reliefDaily.map((r) => r.count), color: '#ef4444' },
        ]" />
      </section>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">💎 잭팟 당첨 이력</h2>
        <table class="w-full min-w-[320px] text-xs">
          <tbody>
            <tr v-for="(j, i) in stats.jackpotHistory" :key="i" class="border-t border-emerald-900">
              <td class="p-1.5">{{ j.nickname }}</td>
              <td class="p-1.5 text-amber-300">{{ j.amount.toLocaleString() }}칩</td>
              <td class="p-1.5 text-emerald-400">{{ j.created_at }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!stats.jackpotHistory.length" class="text-xs text-emerald-500">아직 당첨자가 없습니다.</p>
      </section>
      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">베팅 상위 유저</h2>
        <table class="w-full min-w-[320px] text-xs">
          <tbody>
            <tr v-for="u in stats.topUsers" :key="u.username" class="border-t border-emerald-900">
              <td class="p-1.5">{{ u.nickname }} ({{ u.username }})</td>
              <td class="p-1.5">{{ u.total_wagered.toLocaleString() }}칩</td>
              <td class="p-1.5" :class="u.net >= 0 ? 'text-emerald-300' : 'text-red-400'">
                {{ u.net.toLocaleString() }}칩</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
```

- [ ] **Step 4: 탭·라우트 연결, 빌드, Commit**

`client/src/views/admin/AdminView.vue` tabs에 `{ to: '/admin/stats', label: '통계' }` 추가.
`client/src/router/index.js` admin children에 `{ path: 'stats', component: () => import('../views/admin/AdminStatsView.vue') }` 추가.

Run: `npm --prefix client run build` → 성공

```bash
git add client
git commit -m "feat: 관리자 통계 대시보드 (Chart.js)"
```

---

### Task 4: 클라 — 마이페이지 (손익 직면 화면)

**Files:**
- Create: `client/src/views/MyPageView.vue`
- Modify: `client/src/router/index.js` (`/me`), `client/src/App.vue` (헤더 닉네임 → 마이페이지 링크)

**Interfaces:**
- Consumes: `GET /api/me/stats`, `SimpleChart`
- Produces: `/me` — 총 베팅/총 획득/순손익(손실이면 빨간색 큰 글씨 "총 N칩 손실")·파산 횟수, 최근 30일 일별 순손익 라인 차트, 최근 거래 20건, 책임 도박 안내 박스

- [ ] **Step 1: 구현**

`client/src/views/MyPageView.vue`:
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import SimpleChart from '../components/SimpleChart.vue'

const auth = useAuthStore()
const stats = ref(null)

const TYPE_LABELS = {
  signup_bonus: '가입 보너스', daily_bonus: '출석 보너스', bankrupt_relief: '파산 구제',
  bet: '베팅', payout: '당첨 지급', admin_grant: '운영자 지급', admin_confiscate: '운영자 몰수', jackpot: '잭팟',
}
const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }

onMounted(async () => {
  stats.value = await api('/me/stats')
})
</script>

<template>
  <div v-if="stats" class="mx-auto max-w-3xl space-y-4">
    <h1 class="text-xl font-bold text-amber-400">👤 {{ auth.user?.nickname }}의 마이페이지</h1>

    <section class="rounded-2xl border p-5 text-center"
      :class="stats.totals.net < 0 ? 'border-red-500/40 bg-red-950/30' : 'border-emerald-800 bg-emerald-900/40'">
      <p class="text-sm text-emerald-300">지금까지의 결과</p>
      <p class="mt-1 text-3xl font-black" :class="stats.totals.net < 0 ? 'text-red-400' : 'text-amber-300'">
        {{ stats.totals.net < 0 ? `총 ${Math.abs(stats.totals.net).toLocaleString()}칩 손실`
          : `총 ${stats.totals.net.toLocaleString()}칩 이득` }}
      </p>
      <div class="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><p class="text-xs text-emerald-400">총 베팅</p><p class="font-bold">{{ stats.totals.totalWagered.toLocaleString() }}칩</p></div>
        <div><p class="text-xs text-emerald-400">총 획득</p><p class="font-bold">{{ stats.totals.totalWon.toLocaleString() }}칩</p></div>
        <div><p class="text-xs text-emerald-400">파산 횟수</p><p class="font-bold text-red-400">{{ stats.totals.bankruptCount }}회</p></div>
      </div>
      <p v-if="stats.totals.net < 0" class="mt-3 rounded bg-red-950/50 p-2 text-xs text-red-300">
        가상머니라서 다행입니다. 실제 도박이었다면 이 돈은 돌아오지 않습니다.
      </p>
    </section>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">최근 30일 일별 순손익</h2>
      <SimpleChart type="bar" :labels="stats.daily.map((r) => r.d)" :datasets="[
        { label: '순손익', data: stats.daily.map((r) => r.net), color: '#f59e0b' },
      ]" />
    </section>

    <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">최근 거래</h2>
      <table class="w-full min-w-[420px] text-xs">
        <tbody>
          <tr v-for="(t, i) in stats.recent" :key="i" class="border-t border-emerald-900">
            <td class="p-1.5 text-emerald-400">{{ t.created_at }}</td>
            <td class="p-1.5">{{ TYPE_LABELS[t.type] ?? t.type }}<template v-if="t.game"> ({{ GAME_LABELS[t.game] }})</template></td>
            <td class="p-1.5 text-right" :class="t.amount >= 0 ? 'text-emerald-300' : 'text-red-400'">
              {{ t.amount >= 0 ? '+' : '' }}{{ t.amount.toLocaleString() }}칩</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
```

- [ ] **Step 2: 라우트·헤더 연결**

`client/src/router/index.js` routes에 추가:
```js
  { path: '/me', component: () => import('../views/MyPageView.vue'), meta: { requiresAuth: true } },
```
`client/src/App.vue` 헤더의 닉네임 `<span>`을 다음으로 교체:
```html
        <RouterLink to="/me" class="text-sm text-emerald-200 hover:text-amber-300">{{ auth.user?.nickname }}</RouterLink>
```

- [ ] **Step 3: 빌드 검증 및 Commit**

Run: `npm --prefix client run build` → 성공

```bash
git add client/src
git commit -m "feat: 마이페이지 (손익 직면 화면)"
```

---

### Task 5: 휴식 권장 알림 (1시간)

**Files:**
- Create: `client/src/components/RestReminder.vue`
- Modify: `client/src/App.vue`

**Interfaces:**
- Produces: `RestReminder` — 로그인 상태에서 60분마다 화면 하단 중앙에 토스트 15초 표시: "🕐 접속한 지 N시간이 지났습니다. 잠시 쉬어가는 건 어떨까요? 게임은 도망가지 않습니다." (닫기 버튼 포함)

- [ ] **Step 1: 구현**

`client/src/components/RestReminder.vue`:
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const hours = ref(0)
const visible = ref(false)
let interval, hideTimer

onMounted(() => {
  interval = setInterval(() => {
    hours.value += 1
    visible.value = true
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => (visible.value = false), 15000)
  }, 60 * 60 * 1000)
})
onUnmounted(() => {
  clearInterval(interval)
  clearTimeout(hideTimer)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="visible"
      class="fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/40 bg-emerald-950 px-4 py-3 text-sm text-amber-200 shadow-xl">
      <span>🕐 접속한 지 {{ hours }}시간이 지났습니다. 잠시 쉬어가는 건 어떨까요? 게임은 도망가지 않습니다.</span>
      <button class="text-emerald-400 hover:text-amber-300" @click="visible = false">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

`client/src/App.vue` — import 후 `<JackpotBanner />` 옆에 `<RestReminder v-if="auth.isLoggedIn" />` 추가.

- [ ] **Step 2: 빌드 검증 및 Commit**

Run: `npm --prefix client run build` → 성공

```bash
git add client/src
git commit -m "feat: 1시간 휴식 권장 알림"
```

---

### Task 5.5: 기동 시 미정산 라운드 환불 (스펙 §11)

**Files:**
- Create: `server/src/services/reconcile.js`
- Modify: `server/src/index.js` (`ensureAdmin` 아래에서 호출)
- Test: `server/test/reconcile.test.js`

**Interfaces:**
- Consumes: rounds/transactions 테이블, `applyTransaction`
- Produces: `reconcileUnfinishedRounds(db) → number(환불 건수)` — `ended_at IS NULL`인 라운드에 연결된 `type='bet'` 거래를 유저별로 합산 환불(`type='payout'`, reason `'서버 중단 환불'`)하고 해당 라운드에 `ended_at`과 `result_json='{"aborted":true}'`를 기록. 서버 기동 시 1회 실행.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/reconcile.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'
import { applyTransaction } from '../src/services/wallet.js'
import { reconcileUnfinishedRounds } from '../src/services/reconcile.js'

describe('reconcile', () => {
  it('미정산 라운드의 베팅을 환불하고 라운드를 종료 처리한다', () => {
    const db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', 10000)").run()
    const { lastInsertRowid: roundId } = db.prepare("INSERT INTO rounds (game) VALUES ('blackjack')").run()
    applyTransaction(db, { userId: 1, type: 'bet', amount: -3000, game: 'blackjack', refRoundId: Number(roundId) })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(7000)

    const count = reconcileUnfinishedRounds(db)
    expect(count).toBe(1)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
    expect(db.prepare('SELECT ended_at FROM rounds WHERE id = ?').get(roundId).ended_at).toBeTruthy()
    // 재실행해도 이중 환불 없음
    expect(reconcileUnfinishedRounds(db)).toBe(0)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })

  it('정산 완료된 라운드는 건드리지 않는다', () => {
    const db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', 10000)").run()
    const { lastInsertRowid: roundId } = db
      .prepare("INSERT INTO rounds (game, ended_at) VALUES ('slots', datetime('now'))").run()
    applyTransaction(db, { userId: 1, type: 'bet', amount: -500, game: 'slots', refRoundId: Number(roundId) })
    expect(reconcileUnfinishedRounds(db)).toBe(0)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9500)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix server test` → FAIL

- [ ] **Step 3: 구현**

`server/src/services/reconcile.js`:
```js
import { applyTransaction } from './wallet.js'

export function reconcileUnfinishedRounds(db) {
  const rounds = db.prepare('SELECT id FROM rounds WHERE ended_at IS NULL').all()
  let refunded = 0
  for (const { id } of rounds) {
    const stakes = db.prepare(`
      SELECT user_id, SUM(-amount) staked FROM transactions
      WHERE ref_round_id = ? AND type = 'bet' GROUP BY user_id
    `).all(id)
    for (const { user_id, staked } of stakes) {
      if (staked > 0) {
        applyTransaction(db, {
          userId: user_id, type: 'payout', amount: staked, refRoundId: id, reason: '서버 중단 환불',
        })
        refunded += 1
      }
    }
    db.prepare(`UPDATE rounds SET ended_at = datetime('now'), result_json = '{"aborted":true}' WHERE id = ?`).run(id)
  }
  return refunded
}
```

`server/src/index.js` — `ensureAdmin(db)` 아래에 추가:
```js
import { reconcileUnfinishedRounds } from './services/reconcile.js'
// ...
const refunded = reconcileUnfinishedRounds(db)
if (refunded > 0) console.log(`[reconcile] 미정산 베팅 ${refunded}건 환불 완료`)
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `npm --prefix server test` → PASS (누적 90 tests)

```bash
git add server/src server/test/reconcile.test.js
git commit -m "feat: 기동 시 미정산 라운드 자동 환불"
```

---

### Task 6: 프로덕션 빌드 · 정적 서빙 · README

**Files:**
- Modify: `server/src/app.js` (정적 서빙 + SPA 폴백), `package.json` (루트 build/start 스크립트), `README.md`

**Interfaces:**
- Produces:
  - `createApp`이 `client/dist`가 존재하면 정적 서빙 + GET SPA 폴백 (`/api`·`/socket.io` 제외)
  - 루트 스크립트: `"build": "npm --prefix client run build"`, `"start": "npm --prefix server start"`
  - README: 실행법(dev/prod)·기능 목록·기본 관리자 계정·경고 문구·에셋 출처(MIT) 정리

- [ ] **Step 1: app.js 수정**

`server/src/app.js` — 404 핸들러(`app.use('/api', ...)`) 아래, 에러 핸들러 위에 추가:
```js
import path from 'node:path'
import fs from 'node:fs'
// ... createApp 내부:
  const dist = path.resolve('../client/dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
        return res.sendFile(path.join(dist, 'index.html'))
      }
      next()
    })
  }
```

루트 `package.json` scripts에 추가:
```json
    "build": "npm --prefix client run build",
    "start": "npm --prefix server start"
```

- [ ] **Step 2: README 갱신**

`README.md`를 다음 구조로 갱신 (전체 교체):
```markdown
# 🎰 베가스 — 가상머니 라이브 카지노 (연습 프로젝트)

**현금 결제가 일절 없는 가상머니(칩) 전용** 한국어 라이브 카지노입니다.
도박의 위험성을 알리는 교육 목적을 겸합니다 — 파산 구제 시 누적 손실을 직면시키고,
1시간마다 휴식을 권장하며, 마이페이지에서 본인 손익을 숨김없이 보여줍니다.

## 기능
- 실시간 멀티플레이어: 블랙잭(7석) · 룰렛(유러피언) · 바카라 — 관리자가 만든 테이블에서 서버 주도 라운드
- 슬롯머신 + 전역 프로그레시브 잭팟 (당첨 시 전체 실시간 알림 + 잭팟 사운드)
- 관리자: 유저 관리(지급/몰수/차단), 테이블 CRUD, 공지 CRUD(실시간 푸시), 게임 규칙 설정, 통계 대시보드
- 이코노미: 가입 10,000칩 · 일일 보너스 · 파산 구제(쿨다운+경고)
- 사운드: 조작/딜링/승패 SE(Web Audio 합성) + 잭팟 mp3, 음소거 토글
- 모바일/PC 반응형

## 개발 실행
​```
npm install && npm --prefix server install && npm --prefix client install
npm run dev      # 서버 :3000 + 클라이언트 :5173 → http://localhost:5173
​```

## 프로덕션 실행
​```
npm run build    # client/dist 생성
npm start        # http://localhost:3000 (정적 서빙 포함)
​```

## 계정
- 기본 관리자: `admin` / `admin1234` (server/.env로 변경)

## 테스트
​```
npm test         # 서버 게임 로직·API 단위/통합 테스트 (Vitest)
​```

## 에셋 출처
- 카드 이미지: [playing-cards-assets](https://github.com/hayeah/playing-cards-assets) (MIT)

> 본 사이트는 가상머니 전용입니다. 실제 도박은 오락이 아닌 손실이며, 중독은 질병입니다.
```
(코드펜스 안 제로폭 문자는 실제 파일에서 일반 ``` 로)

- [ ] **Step 3: 프로덕션 기동 확인 후 Commit**

Run: `npm run build` 후 `npm start` → 브라우저 `http://localhost:3000` 접속
Expected: 로그인 화면 렌더, 로그인·로비·소켓 정상 (확인 후 종료)

```bash
git add -A
git commit -m "feat: 프로덕션 정적 서빙 및 README 정리"
```

---

### Task 7: 최종 전체 검증 (E2E 수동 체크리스트)

- [ ] **Step 1: 전체 테스트**

Run: `npm --prefix server test` → PASS (90 tests)

- [ ] **Step 2: 최종 시나리오 (dev 모드, 창 3개: admin + 유저 A + 유저 B)**

1. **신규 유저 여정**: 가입(동의 필수) → 로비 → 출석 보너스 → 슬롯 몇 판 → 블랙잭 테이블 참가 → 마이페이지에서 손익 확인
2. **멀티플레이**: A·B가 블랙잭 같은 테이블에서 한 라운드, 룰렛·바카라 동시 베팅 라운드 각 1회
3. **관리자 여정**: 테이블 생성/닫기, 공지 등록(실시간 배너), A에게 지급 → 몰수 → 차단(즉시 강제 종료) → 해제, 규칙 변경(soft17, betSeconds)이 다음 라운드 반영, 통계 대시보드 수치가 방금 플레이와 일치하는지 확인
4. **책임 도박**: 전액 몰수로 A 파산 → 구제 모달 경고·쿨다운 → 마이페이지 손실 표시
5. **잭팟**: (플랜 3 방식으로 rng 임시 조작) 당첨 → 사운드 + 전체 배너 + 통계 이력 → 원복
6. **복원력**: 게임 중 서버 재시작(`npm run dev` 재기동) → 재접속 시 테이블 목록·잔액 정상, 미정산 라운드가 있었다면 잔액이 음수가 아님을 확인
7. **반응형**: 375px에서 로비·블랙잭·룰렛·바카라·슬롯·관리자 전 화면 가로 스크롤 없음
8. **음소거**: 토글 후 전 게임 무음, 새로고침 유지

Expected: 전 항목 통과. 실패 시 수정 커밋 후 해당 항목 재검증.

- [ ] **Step 3: 마무리 Commit**

```bash
git add -A
git commit -m "chore: 플랜 6 완료 — 베가스 v1 전체 검증 통과"
```
