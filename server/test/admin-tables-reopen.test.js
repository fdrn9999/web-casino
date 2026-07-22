import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer } from '../src/sockets/index.js'
import { startRunner } from '../src/games/index.js'
import { createTable } from '../src/services/tables.js'
import { ensureAdmin } from '../src/services/bootstrap.js'
import { getRunner, clearRunners, allRunners, registerRunner } from '../src/games/registry.js'

// BUG-08: reopen이 기존 러너를 확인하지 않고 새 러너를 덮어써
// 옛 러너의 타이머가 계속 발화(이중 정산)할 수 있던 레이스를 검증한다.
describe('admin-tables reopen 레이스 방지', () => {
  let db, httpServer, io, app, port, adminToken, tableId

  beforeAll(async () => {
    db = createDb()
    clearRunners()
    ensureAdmin(db)
    const ctx = {}
    app = createApp(db, ctx)
    httpServer = createServer(app)
    io = createSocketServer(httpServer, db)
    ctx.io = io
    ctx.startRunner = (table) => startRunner(db, io, table)
    await new Promise((r) => httpServer.listen(0, r))
    port = httpServer.address().port
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token

    const table = createTable(db, { game: 'roulette', name: '리오픈 테스트' }, null)
    tableId = table.id
    startRunner(db, io, { ...table, limits_json: null })
  })

  afterAll(() => new Promise((r) => httpServer.close(r)))

  it('이미 열려 있고 러너가 등록된 테이블을 reopen하면 409를 반환하고 러너는 하나만 유지된다', async () => {
    const runnerBefore = getRunner(tableId)
    expect(runnerBefore).toBeTruthy()

    const res = await request(app).post(`/api/admin/tables/${tableId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(409)
    expect(res.body.error).toBeTruthy()

    // 러너가 교체되지 않고 그대로여야 한다(이중 러너 없음).
    expect(getRunner(tableId)).toBe(runnerBefore)
    expect(allRunners().filter((r) => r === runnerBefore).length).toBe(1)
  })

  it('닫힌 테이블을 reopen하면 정상적으로 열리고 러너가 하나만 등록된다', async () => {
    await request(app).post(`/api/admin/tables/${tableId}/close`).set('Authorization', `Bearer ${adminToken}`)
    expect(getRunner(tableId)).toBeFalsy()

    const res = await request(app).post(`/api/admin/tables/${tableId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const runnerAfter = getRunner(tableId)
    expect(runnerAfter).toBeTruthy()

    // 곧바로 다시 reopen을 요청하면(중복 클릭 시나리오) 409여야 하고 러너 교체가 없어야 한다.
    const dup = await request(app).post(`/api/admin/tables/${tableId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(dup.status).toBe(409)
    expect(getRunner(tableId)).toBe(runnerAfter)
  })
})

describe('registry.registerRunner 방어 로직', () => {
  beforeEach(() => clearRunners())

  it('같은 id에 새 러너를 등록하면 기존 러너의 stop()이 호출된다', () => {
    let stopped = false
    const oldRunner = { stop: ({ refund } = {}) => { stopped = true; expect(refund).toBe(true) } }
    const newRunner = { stop: () => {} }

    registerRunner(1, oldRunner)
    registerRunner(1, newRunner)

    expect(stopped).toBe(true)
    expect(getRunner(1)).toBe(newRunner)
  })
})
