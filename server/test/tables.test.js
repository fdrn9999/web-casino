import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { ensureAdmin } from '../src/services/bootstrap.js'
import { registerRunner, clearRunners } from '../src/games/registry.js'

describe('tables', () => {
  let db, app, adminToken, userToken, started, stopped

  beforeEach(async () => {
    db = createDb()
    clearRunners()
    started = []
    stopped = []
    app = createApp(db, {
      io: { emit() {}, to: () => ({ emit() {} }), in: () => ({ disconnectSockets() {} }) },
      startRunner: (table) => started.push(table.id),
    })
    ensureAdmin(db)
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
    userToken = (await request(app).post('/api/auth/signup')
      .send({ username: 'player1', password: 'password1', nickname: '플레이어', agreed: true })).body.token
  })

  async function createTable(body) {
    return request(app).post('/api/admin/tables').set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  it('관리자가 테이블을 만들면 러너가 기동되고 목록에 보인다', async () => {
    const res = await createTable({ game: 'blackjack', name: '블랙잭 1번', limits: { minBet: 100, maxBet: 5000 } })
    expect(res.status).toBe(201)
    expect(started).toContain(res.body.table.id)
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables[0]).toMatchObject({ name: '블랙잭 1번', game: 'blackjack', playerCount: 0 })
    expect(list.body.tables[0].limits).toEqual({ minBet: 100, maxBet: 5000 })
  })

  it('검증: 잘못된 게임/이름/한도는 400', async () => {
    expect((await createTable({ game: 'poker', name: 'x' })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: '' })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'ok', limits: { minBet: 500, maxBet: 100 } })).status).toBe(400)
  })

  it('이름이 문자열이 아니면 400', async () => {
    const res = await createTable({ game: 'blackjack', name: 12345 })
    expect(res.status).toBe(400)
  })

  it('존재하지 않는 테이블을 수정하면 404', async () => {
    const res = await request(app).put('/api/admin/tables/999999')
      .set('Authorization', `Bearer ${adminToken}`).send({ name: '새 이름' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('테이블을 찾을 수 없습니다.')
  })

  it('존재하는 테이블을 수정하면 200', async () => {
    const { body } = await createTable({ game: 'blackjack', name: '수정 전' })
    const res = await request(app).put(`/api/admin/tables/${body.table.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ name: '수정 후' })
    expect(res.status).toBe(200)
    expect(res.body.table.name).toBe('수정 후')
  })

  it('부분 규칙 오버라이드(게임별 방 규칙)를 허용하고 저장된다', async () => {
    const res = await createTable({
      game: 'blackjack',
      name: '규칙 오버라이드',
      limits: { decks: 2, hitSoft17: true, maxBet: 50000 },
    })
    expect(res.status).toBe(201)
    expect(res.body.table.limits).toEqual({ decks: 2, hitSoft17: true, maxBet: 50000 })

    const rouletteRes = await createTable({ game: 'roulette', name: '룰렛 오버라이드', limits: { spinSeconds: 10 } })
    expect(rouletteRes.status).toBe(201)
    expect(rouletteRes.body.table.limits).toEqual({ spinSeconds: 10 })

    const baccaratRes = await createTable({ game: 'baccarat', name: '바카라 오버라이드', limits: { tiePayout: 9, pairPayout: 12 } })
    expect(baccaratRes.status).toBe(201)
    expect(baccaratRes.body.table.limits).toEqual({ tiePayout: 9, pairPayout: 12 })
  })

  it('규칙 오버라이드에 알 수 없는 키가 있으면 400', async () => {
    const res = await createTable({ game: 'blackjack', name: '알수없는키', limits: { foo: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/알 수 없는 규칙 키/)
  })

  it('규칙 오버라이드 값이 범위를 벗어나거나 타입이 틀리면 400', async () => {
    expect((await createTable({ game: 'blackjack', name: 'a', limits: { decks: 9 } })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'b', limits: { decks: 0 } })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'c', limits: { decks: 2.5 } })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'd', limits: { hitSoft17: 'yes' } })).status).toBe(400)
    expect((await createTable({ game: 'blackjack', name: 'e', limits: { blackjackPayout: 3 } })).status).toBe(400)
    expect((await createTable({ game: 'roulette', name: 'f', limits: { spinSeconds: 1 } })).status).toBe(400)
    expect((await createTable({ game: 'baccarat', name: 'g', limits: { tiePayout: -1 } })).status).toBe(400)
  })

  it('부분 오버라이드가 한쪽 베팅 한도만 지정해도 기본값과 병합된 유효 최소<최대를 강제한다', async () => {
    // 기본 블랙잭 minBet=100. maxBet만 90으로 지정하면 유효 최소(100) >= 유효 최대(90) → 400
    const bad = await createTable({ game: 'blackjack', name: '유효한도위반', limits: { maxBet: 90 } })
    expect(bad.status).toBe(400)

    // 기본 블랙잭 maxBet=10000. minBet만 5000으로 지정하면 유효 5000 < 10000 → 통과
    const ok = await createTable({ game: 'blackjack', name: '유효한도통과', limits: { minBet: 5000 } })
    expect(ok.status).toBe(201)
    expect(ok.body.table.limits).toEqual({ minBet: 5000 })
  })

  it('일반 유저는 생성 불가(403)', async () => {
    const res = await request(app).post('/api/admin/tables')
      .set('Authorization', `Bearer ${userToken}`).send({ game: 'blackjack', name: 'x' })
    expect(res.status).toBe(403)
  })

  it('닫기 시 러너가 stop(refund)되고 목록에서 closed로 보인다', async () => {
    const { body } = await createTable({ game: 'blackjack', name: '닫을 테이블' })
    const id = body.table.id
    registerRunner(id, { playerCount: () => 3, stop: (o) => stopped.push(o) })
    await request(app).post(`/api/admin/tables/${id}/close`).set('Authorization', `Bearer ${adminToken}`)
    expect(stopped).toEqual([{ refund: true }])
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables[0].status).toBe('closed')
  })

  it('삭제하면 목록에서 사라진다', async () => {
    const { body } = await createTable({ game: 'blackjack', name: '삭제 테이블' })
    await request(app).delete(`/api/admin/tables/${body.table.id}`).set('Authorization', `Bearer ${adminToken}`)
    const list = await request(app).get('/api/tables').set('Authorization', `Bearer ${userToken}`)
    expect(list.body.tables.length).toBe(0)
  })
})
