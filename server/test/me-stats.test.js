import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { applyTransaction } from '../src/services/wallet.js'
import { meStatsRouter } from '../src/routes/me-stats.js'

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

  it('라우터 자체가 미인증을 401로 막는다 (격리)', async () => {
    const bare = express()
    bare.use(express.json())
    bare.use('/api/me/stats', meStatsRouter(db))
    const res = await request(bare).get('/api/me/stats')
    expect(res.status).toBe(401)
  })
})
