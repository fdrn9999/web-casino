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

  it('잔액 부족 스핀은 400이며 orphaned round를 남기지 않는다', async () => {
    const app = appWithRng(db, [idxCherry, idxBell, idxStar])
    await signup(app)
    const { id: userId } = db.prepare('SELECT id FROM users WHERE username = ?').get('spinner1')
    db.prepare('UPDATE users SET balance = 50 WHERE id = ?').run(userId)
    const res = await request(app).post('/api/slots/spin')
      .set('Authorization', `Bearer ${token}`).send({ bet: 100 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('칩이 부족합니다.')
    expect(db.prepare("SELECT COUNT(*) c FROM rounds WHERE game = 'slots'").get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(0)
  })
})
