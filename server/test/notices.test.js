import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

describe('notices', () => {
  let db, app, adminToken, userToken, emitted

  beforeEach(async () => {
    db = createDb()
    emitted = []
    app = createApp(db, { io: { emit: (ev, p) => emitted.push({ ev, p }), to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) } })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
    userToken = (await request(app).post('/api/auth/signup')
      .send({ username: 'reader1', password: 'password1', nickname: '독자', agreed: true })).body.token
  })

  it('관리자가 공지를 생성하면 브로드캐스트되고 유저가 조회할 수 있다', async () => {
    const created = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: '점검 안내', body: '오늘 밤 점검입니다.', pinned: true })
    expect(created.status).toBe(201)
    expect(emitted.some((e) => e.ev === 'notice:new' && e.p.title === '점검 안내')).toBe(true)

    const list = await request(app).get('/api/notices').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.notices[0].title).toBe('점검 안내')
    expect(list.body.notices[0].pinned).toBe(1)
  })

  it('일반 유저는 공지 CUD 불가(403)', async () => {
    const res = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${userToken}`).send({ title: 'x', body: 'y' })
    expect(res.status).toBe(403)
  })

  it('수정과 삭제가 동작한다', async () => {
    const { body } = await request(app).post('/api/admin/notices')
      .set('Authorization', `Bearer ${adminToken}`).send({ title: '이벤트', body: '내용' })
    const id = body.notice.id
    const upd = await request(app).put(`/api/admin/notices/${id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ title: '이벤트(수정)', body: '내용2', pinned: false })
    expect(upd.body.notice.title).toBe('이벤트(수정)')
    const del = await request(app).delete(`/api/admin/notices/${id}`).set('Authorization', `Bearer ${adminToken}`)
    expect(del.body.ok).toBe(true)
    const list = await request(app).get('/api/notices').set('Authorization', `Bearer ${adminToken}`)
    expect(list.body.notices.length).toBe(0)
  })
})
