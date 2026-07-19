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
