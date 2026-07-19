import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { io as ioc } from 'socket.io-client'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer } from '../src/sockets/index.js'
import { startRunner } from '../src/games/index.js'
import { createTable } from '../src/services/tables.js'
import { saveSettings } from '../src/services/settings.js'
import { clearRunners } from '../src/games/registry.js'

describe('blackjack socket', () => {
  let db, httpServer, io, port, token, tableId

  beforeAll(async () => {
    db = createDb()
    clearRunners()
    saveSettings(db, 'blackjack', { betSeconds: 600, turnSeconds: 600 }, null) // 테스트 중 자동 진행 방지
    const app = createApp(db, {})
    httpServer = createServer(app)
    io = createSocketServer(httpServer, db)
    await new Promise((r) => httpServer.listen(0, r))
    port = httpServer.address().port
    const res = await request(app).post('/api/auth/signup')
      .send({ username: 'bjsock', password: 'password1', nickname: '비제이', agreed: true })
    token = res.body.token
    const table = createTable(db, { game: 'blackjack', name: '소켓 테스트' }, null)
    tableId = table.id
    startRunner(db, io, { ...table, limits_json: null })
  })

  afterAll(() => new Promise((r) => httpServer.close(r)))

  function connect() {
    return ioc(`http://localhost:${port}/blackjack`, { auth: { token }, transports: ['websocket'] })
  }

  it('테이블 참가 → 착석 → 베팅이 소켓으로 동작한다', async () => {
    const socket = connect()
    await new Promise((res, rej) => {
      socket.on('connect', res)
      socket.on('connect_error', rej)
    })

    const joined = await socket.emitWithAck('table:join', { tableId })
    expect(joined.state.phase).toBe('waiting')

    // 리스너를 emit 전에(같은 동기 틱에서) 등록해 ack와 table:state 브로드캐스트 간
    // 도착 순서 경합을 피한다 (동일 TCP read에서 함께 도착·동기 처리될 수 있음).
    const stateAfterSitPromise = new Promise((r) => socket.once('table:state', r))
    const sat = await socket.emitWithAck('seat:join', { seat: 3 })
    expect(sat.ok).toBe(true)

    const stateAfterSit = await stateAfterSitPromise
    expect(stateAfterSit.phase).toBe('betting')

    const bet = await socket.emitWithAck('bet:place', { amount: 500 })
    expect(bet.ok).toBe(true)
    expect(db.prepare("SELECT balance FROM users WHERE username = 'bjsock'").get().balance).toBe(9500)

    const badBet = await socket.emitWithAck('bet:place', { amount: 500 })
    expect(badBet.error).toBeTruthy()

    socket.close()
  })

  it('없는 테이블 참가는 에러', async () => {
    const socket = connect()
    await new Promise((r) => socket.on('connect', r))
    const res = await socket.emitWithAck('table:join', { tableId: 999 })
    expect(res.error).toBeTruthy()
    socket.close()
  })
})
