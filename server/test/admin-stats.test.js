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
