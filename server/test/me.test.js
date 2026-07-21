import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'

const SIGNUP = { username: 'mypage1', password: 'password1', nickname: '유저', agreed: true }

function insertBet(db, { userId, game, amount, payout }) {
  const { lastInsertRowid: roundId } = db
    .prepare("INSERT INTO rounds (game, ended_at) VALUES (?, datetime('now'))")
    .run(game)
  db.prepare('INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)')
    .run(roundId, userId, JSON.stringify({}), amount, payout)
}

describe('me - 비밀번호 변경', () => {
  let db, app, token, userId

  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    const u = await request(app).post('/api/auth/signup').send(SIGNUP)
    token = u.body.token
    userId = u.body.user.id
  })

  it('현재 비밀번호가 틀리면 400', async () => {
    const res = await request(app).post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpass1', newPassword: 'newpassword1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('현재 비밀번호')
  })

  it('새 비밀번호가 8자 미만이면 400', async () => {
    const res = await request(app).post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password1', newPassword: 'short1' })
    expect(res.status).toBe(400)
  })

  it('새 비밀번호가 현재 비밀번호와 같으면 400', async () => {
    const res = await request(app).post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password1', newPassword: 'password1' })
    expect(res.status).toBe(400)
  })

  it('미로그인은 401', async () => {
    const res = await request(app).post('/api/me/password')
      .send({ currentPassword: 'password1', newPassword: 'newpassword1' })
    expect(res.status).toBe(401)
  })

  it('성공 시 해시가 갱신되어 기존 비밀번호는 로그인 실패, 새 비밀번호는 로그인 성공', async () => {
    const res = await request(app).post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password1', newPassword: 'newpassword1' })
    expect(res.status).toBe(200)
    expect(res.body.error).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('password_hash')
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/\$2[aby]\$/) // bcrypt 해시 미노출

    const oldLogin = await request(app).post('/api/auth/login').send({ username: 'mypage1', password: 'password1' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app).post('/api/auth/login').send({ username: 'mypage1', password: 'newpassword1' })
    expect(newLogin.status).toBe(200)

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)
    expect(bcrypt.compareSync('newpassword1', row.password_hash)).toBe(true)
  })
})

describe('me - 베팅 기록', () => {
  let db, app, token, userId

  beforeEach(async () => {
    db = createDb()
    app = createApp(db, {})
    const u = await request(app).post('/api/auth/signup').send(SIGNUP)
    token = u.body.token
    userId = u.body.user.id
    insertBet(db, { userId, game: 'slots', amount: 1000, payout: 3000 }) // 승
    insertBet(db, { userId, game: 'roulette', amount: 2000, payout: 0 }) // 패
    insertBet(db, { userId, game: 'blackjack', amount: 500, payout: 500 }) // 무
  })

  it('본인의 베팅 기록을 최신순으로 반환한다', async () => {
    const res = await request(app).get('/api/me/bets').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3)
    expect(res.body.bets.length).toBe(3)
    expect(res.body.bets[0]).toMatchObject({ game: 'blackjack', amount: 500, payout: 500, net: 0, result: 'push' })
    expect(res.body.bets[1]).toMatchObject({ game: 'roulette', amount: 2000, payout: 0, net: -2000, result: 'lose' })
    expect(res.body.bets[2]).toMatchObject({ game: 'slots', amount: 1000, payout: 3000, net: 2000, result: 'win' })
  })

  it('limit/offset을 반영한다', async () => {
    const res = await request(app).get('/api/me/bets?limit=1&offset=1').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.bets.length).toBe(1)
    expect(res.body.bets[0].game).toBe('roulette')
    expect(res.body.total).toBe(3)
  })

  it('limit은 최대 100으로 제한된다', async () => {
    const res = await request(app).get('/api/me/bets?limit=9999').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(100)
  })

  it('미로그인은 401', async () => {
    expect((await request(app).get('/api/me/bets')).status).toBe(401)
  })

  it('다른 유저의 베팅 기록은 보이지 않는다', async () => {
    const other = await request(app).post('/api/auth/signup')
      .send({ username: 'mypage2', password: 'password1', nickname: '유저2', agreed: true })
    const res = await request(app).get('/api/me/bets').set('Authorization', `Bearer ${other.body.token}`)
    expect(res.status).toBe(200)
    expect(res.body.bets.length).toBe(0)
    expect(res.body.total).toBe(0)
  })
})
