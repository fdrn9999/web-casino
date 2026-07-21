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

  it('BUG-12: 두 번째 요청 후에도 잔액이 불변이며 daily_claims에 한 행만 남는다', async () => {
    const ok = await request(app).post('/api/bonus/daily').set('Authorization', `Bearer ${token}`)
    const dup = await request(app).post('/api/bonus/daily').set('Authorization', `Bearer ${token}`)
    expect(dup.status).toBe(409)

    const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(id)
    expect(userRow.balance).toBe(ok.body.balance)

    const claimRows = db.prepare("SELECT COUNT(*) c FROM daily_claims WHERE user_id = ? AND claim_type = 'daily_bonus'").get(id)
    expect(claimRows.c).toBe(1)
  })

  it('BUG-12: daily_claims에 오늘자 행이 이미 있으면 컬럼 값과 무관하게 UNIQUE로 거부된다', async () => {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    db.prepare('INSERT INTO daily_claims (user_id, claim_type, claim_date) VALUES (?, ?, ?)').run(id, 'daily_bonus', today)

    const res = await request(app).post('/api/bonus/daily').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(409)
    const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(id)
    expect(userRow.balance).toBe(10000)
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
