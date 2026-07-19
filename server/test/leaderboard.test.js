import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('leaderboard (명예의 전당)', () => {
  let db, app, token

  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    ensureAdmin(db)
    // 관리자 잔액을 최고로 올려도 richest 목록에는 나오면 안 됨 (role='user'만)
    db.prepare("UPDATE users SET balance = 999999 WHERE role = 'admin'").run()

    const richguy = await request(app).post('/api/auth/signup')
      .send({ username: 'richguy1', password: 'password1', nickname: '부자', agreed: true })
    applyTransaction(db, { userId: richguy.body.user.id, type: 'jackpot', amount: 50000, game: 'slots' })

    const midguy = await request(app).post('/api/auth/signup')
      .send({ username: 'midguy1', password: 'password1', nickname: '중간', agreed: true })
    applyTransaction(db, { userId: midguy.body.user.id, type: 'payout', amount: 5000, game: 'roulette' })
    token = midguy.body.token

    const loseguy = await request(app).post('/api/auth/signup')
      .send({ username: 'loseguy1', password: 'password1', nickname: '손실왕', agreed: true })
    applyTransaction(db, { userId: loseguy.body.user.id, type: 'bet', amount: -8000, game: 'blackjack' })
    applyTransaction(db, { userId: loseguy.body.user.id, type: 'payout', amount: 1000, game: 'blackjack' })

    const loseguy2 = await request(app).post('/api/auth/signup')
      .send({ username: 'loseguy2', password: 'password1', nickname: '손실왕2', agreed: true })
    applyTransaction(db, { userId: loseguy2.body.user.id, type: 'bet', amount: -5000, game: 'baccarat' })
    applyTransaction(db, { userId: loseguy2.body.user.id, type: 'payout', amount: 500, game: 'baccarat' })
  })

  it('부자 순위는 잔액 내림차순이며 일반 유저만 포함한다', async () => {
    const res = await request(app).get('/api/leaderboard').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const { richest } = res.body
    expect(richest.map((r) => r.nickname)).not.toContain('운영자')
    expect(richest[0]).toMatchObject({ nickname: '부자', username: 'richguy1', balance: 60000 })
    expect(richest[1]).toMatchObject({ nickname: '중간', username: 'midguy1', balance: 15000 })
    for (let i = 1; i < richest.length; i++) {
      expect(richest[i - 1].balance).toBeGreaterThanOrEqual(richest[i].balance)
    }
  })

  it('최대 당첨은 단일 payout/jackpot 금액 내림차순이다', async () => {
    const res = await request(app).get('/api/leaderboard').set('Authorization', `Bearer ${token}`)
    const { biggestWins } = res.body
    expect(biggestWins[0]).toMatchObject({ nickname: '부자', amount: 50000, game: 'slots' })
    expect(biggestWins[0]).toHaveProperty('created_at')
    expect(biggestWins[1]).toMatchObject({ nickname: '중간', amount: 5000, game: 'roulette' })
    expect(biggestWins[2]).toMatchObject({ nickname: '손실왕', amount: 1000, game: 'blackjack' })
    for (let i = 1; i < biggestWins.length; i++) {
      expect(biggestWins[i - 1].amount).toBeGreaterThanOrEqual(biggestWins[i].amount)
    }
  })

  it('최대 손실은 순손실(총 배팅-총 획득) 내림차순이며 순손실>0, 일반 유저만 포함한다', async () => {
    const res = await request(app).get('/api/leaderboard').set('Authorization', `Bearer ${token}`)
    const { biggestLosers } = res.body
    expect(biggestLosers[0]).toMatchObject({ nickname: '손실왕', netLoss: 7000 })
    expect(biggestLosers[1]).toMatchObject({ nickname: '손실왕2', netLoss: 4500 })
    expect(biggestLosers.map((l) => l.nickname)).not.toContain('부자')
    expect(biggestLosers.map((l) => l.nickname)).not.toContain('중간')
    for (const l of biggestLosers) expect(l.netLoss).toBeGreaterThan(0)
  })

  it('미로그인은 401', async () => {
    expect((await request(app).get('/api/leaderboard')).status).toBe(401)
  })
})
