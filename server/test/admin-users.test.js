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
      of: () => fakeIo,
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
