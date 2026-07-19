import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'

async function signup(app, u='att1') {
  const r = await request(app).post('/api/auth/signup').send({ username:u, password:'password1', nickname:'출석', agreed:true })
  return { token:r.body.token, id:r.body.user.id }
}
describe('attendance', () => {
  let db, app, token, id
  beforeEach(async () => { db=createDb(); app=createApp(db,{}); ({token,id}=await signup(app)) })

  it('첫 출석은 1일차 보상 1000, streak 1', async () => {
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.status).toBe(200); expect(res.body.streak).toBe(1); expect(res.body.reward).toBe(1000)
    expect(res.body.balance).toBe(11000)
  })
  it('같은 날 두 번째는 409', async () => {
    await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    const dup = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(dup.status).toBe(409)
  })
  it('어제 출석 상태면 streak 증가(2일차 1500)', async () => {
    // 어제 날짜로 강제
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-1 day'), attendance_streak = 1 WHERE id = ?").run(id)
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.body.streak).toBe(2); expect(res.body.reward).toBe(1500)
  })
  it('공백(이틀 이상 전)이면 streak 리셋 1', async () => {
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-3 day'), attendance_streak = 5 WHERE id = ?").run(id)
    const res = await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.body.streak).toBe(1)
  })
  it('GET status: todayClaimed 반영', async () => {
    const before = await request(app).get('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(before.body.todayClaimed).toBe(false)
    await request(app).post('/api/attendance').set('Authorization',`Bearer ${token}`)
    const after = await request(app).get('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(after.body.todayClaimed).toBe(true); expect(after.body.streak).toBe(1)
  })
  it('GET: 끊긴 streak(5일전)은 nextReward 1000 미리보기', async () => {
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-5 day'), attendance_streak = 5 WHERE id = ?").run(id)
    const res = await request(app).get('/api/attendance').set('Authorization',`Bearer ${token}`)
    expect(res.body.nextReward).toBe(1000)
    expect(res.body.streak).toBe(5)
    expect(res.body.todayClaimed).toBe(false)
  })
})
