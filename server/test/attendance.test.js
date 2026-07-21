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

  it('BUG-02: 당일 두 번째 요청은 잔액 불변(DB UNIQUE 제약으로 이중 지급 원천 차단)', async () => {
    const first = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(first.status).toBe(200)
    const balanceAfterFirst = first.body.balance

    const second = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(second.status).toBe(409)

    const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(id)
    expect(userRow.balance).toBe(balanceAfterFirst)

    const claimRows = db.prepare("SELECT COUNT(*) c FROM daily_claims WHERE user_id = ? AND claim_type = 'attendance'").get(id)
    expect(claimRows.c).toBe(1)

    const txRows = db.prepare("SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND type = 'attendance'").get(id)
    expect(txRows.c).toBe(1)
  })

  it('BUG-02: last_attendance 컬럼이 오늘로 이미 조작돼 있어도 daily_claims UNIQUE가 이중 삽입을 거부한다', async () => {
    // 컬럼 기반 검사를 우회한 것처럼 daily_claims에 먼저 오늘자 행을 직접 넣어
    // DB 레벨 UNIQUE 제약이 독립적으로도 중복 지급을 막는지 확인한다.
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    db.prepare('INSERT INTO daily_claims (user_id, claim_type, claim_date) VALUES (?, ?, ?)').run(id, 'attendance', today)

    const res = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(409)

    const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(id)
    expect(userRow.balance).toBe(10000)
  })

  it('BUG-02: 모달이 읽는 GET 상태가 클레임 로직과 정확히 일치한다(연속 이틀 청구 후 스트릭 확인)', async () => {
    const day1 = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(day1.body.streak).toBe(1)
    const statusAfterDay1 = await request(app).get('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(statusAfterDay1.body.todayClaimed).toBe(true)
    expect(statusAfterDay1.body.streak).toBe(1)

    // 다음날로 강제 이동(어제 = 오늘 claim 기준일)
    db.prepare("UPDATE users SET last_attendance = date('now','+9 hours','-1 day') WHERE id = ?").run(id)
    db.prepare("UPDATE daily_claims SET claim_date = date('now','+9 hours','-1 day') WHERE user_id = ? AND claim_type = 'attendance'").run(id)

    const statusDay2 = await request(app).get('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(statusDay2.body.todayClaimed).toBe(false)

    const day2 = await request(app).post('/api/attendance').set('Authorization', `Bearer ${token}`)
    expect(day2.status).toBe(200)
    expect(day2.body.streak).toBe(2)
    expect(day2.body.reward).toBe(1500)
  })
})
