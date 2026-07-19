import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'

describe('admin settings', () => {
  let db, app, adminToken
  beforeEach(async () => {
    db = createDb()
    app = createApp(db, { io: { emit() {}, to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) } })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
  })

  it('블랙잭 설정을 조회·수정한다', async () => {
    const get = await request(app).get('/api/admin/settings/blackjack').set('Authorization', `Bearer ${adminToken}`)
    expect(get.body.settings.decks).toBe(6)
    const put = await request(app).put('/api/admin/settings/blackjack')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decks: 8, hitSoft17: true, surrenderAllowed: false })
    expect(put.status).toBe(200)
    expect(put.body.settings).toMatchObject({ decks: 8, hitSoft17: true, surrenderAllowed: false, minBet: 100 })
  })

  it('검증: 범위·타입·미지 키·min>=max는 400', async () => {
    const cases = [
      { decks: 9 },
      { decks: 2.5 },
      { hitSoft17: 'yes' },
      { unknownKey: 1 },
      { minBet: 5000, maxBet: 100 },
      { blackjackPayout: 3 },
    ]
    for (const body of cases) {
      const res = await request(app).put('/api/admin/settings/blackjack')
        .set('Authorization', `Bearer ${adminToken}`).send(body)
      expect(res.status).toBe(400)
    }
  })

  it('없는 게임 키는 404', async () => {
    const res = await request(app).get('/api/admin/settings/poker').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('없는 설정 그룹입니다.')
  })
})
