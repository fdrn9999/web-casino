import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { io as ioc } from 'socket.io-client'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer, disconnectUser } from '../src/sockets/index.js'
import { startRunner } from '../src/games/index.js'
import { createTable } from '../src/services/tables.js'
import { saveSettings } from '../src/services/settings.js'
import { clearRunners } from '../src/games/registry.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('blackjack socket', () => {
  let db, httpServer, io, port, token, tableId, app

  beforeAll(async () => {
    db = createDb()
    clearRunners()
    saveSettings(db, 'blackjack', { betSeconds: 600, turnSeconds: 600 }, null) // 테스트 중 자동 진행 방지
    app = createApp(db, {})
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

    // 확정 버튼 없는 즉시 누적 베팅: 같은 좌석에 칩을 더 얹으면 합산된다(자동확정 모델).
    const more = await socket.emitWithAck('bet:place', { amount: 500 })
    expect(more.ok).toBe(true)
    expect(db.prepare("SELECT balance FROM users WHERE username = 'bjsock'").get().balance).toBe(9000)

    socket.close()
  })

  it('없는 테이블 참가는 에러', async () => {
    const socket = connect()
    await new Promise((r) => socket.on('connect', r))
    const res = await socket.emitWithAck('table:join', { tableId: 999 })
    expect(res.error).toBeTruthy()
    socket.close()
  })

  it('seat:leave에 빈 객체 payload를 보내도(실제 클라이언트처럼) 서버가 죽지 않고 정상 응답한다', async () => {
    // 다른 테스트가 이미 앉힌 유저와 좌석이 겹치지 않도록 별도 유저로 접속한다.
    const signup = await request(app).post('/api/auth/signup')
      .send({ username: 'bjsock2', password: 'password1', nickname: '비제이2', agreed: true })
    const token2 = signup.body.token
    const socket = ioc(`http://localhost:${port}/blackjack`, { auth: { token: token2 }, transports: ['websocket'] })
    await new Promise((res, rej) => {
      socket.on('connect', res)
      socket.on('connect_error', rej)
    })

    const joined = await socket.emitWithAck('table:join', { tableId })
    expect(joined.error).toBeFalsy()

    const sat = await socket.emitWithAck('seat:join', { seat: 4 })
    expect(sat.ok).toBe(true)

    // 실제 클라이언트(emitAck)는 항상 payload 객체를 함께 보낸다: emitWithAck('seat:leave', {})
    const left = await socket.emitWithAck('seat:leave', {})
    expect(left.ok).toBe(true)

    // 서버가 살아있는지 다른 소켓으로 확인 (죽었다면 새 연결이 되지 않는다)
    const check = connect()
    await new Promise((res, rej) => {
      check.on('connect', res)
      check.on('connect_error', rej)
    })
    check.close()

    socket.close()
  })

  it('관리자가 유저를 차단하면 활성 게임 소켓(/blackjack)도 강제 종료된다', async () => {
    const signup = await request(app).post('/api/auth/signup')
      .send({ username: 'bjsock3', password: 'password1', nickname: '비제이3', agreed: true })
    const userId = signup.body.user.id
    const token3 = signup.body.token
    const socket = ioc(`http://localhost:${port}/blackjack`, { auth: { token: token3 }, transports: ['websocket'] })
    await new Promise((res, rej) => {
      socket.on('connect', res)
      socket.on('connect_error', rej)
    })

    const joined = await socket.emitWithAck('table:join', { tableId })
    expect(joined.error).toBeFalsy()

    const bannedPromise = new Promise((res) => socket.once('session:banned', res))
    const disconnectPromise = new Promise((res) => socket.once('disconnect', res))

    disconnectUser(io, userId, 'banned')

    const banned = await bannedPromise
    expect(banned.reason).toBe('banned')
    await disconnectPromise
    expect(socket.connected).toBe(false)
  })

  // BUG-01: 게임 네임스페이스 소켓(딥링크/새로고침으로 테이블에 바로 들어온 세션)도
  // 잔고 변경 이벤트를 받아야 헤더/HUD가 새로고침 없이 갱신된다.
  it('게임 네임스페이스(/blackjack) 소켓도 balance:update를 받는다', async () => {
    const signup = await request(app).post('/api/auth/signup')
      .send({ username: 'bjsock4', password: 'password1', nickname: '비제이4', agreed: true })
    const userId = signup.body.user.id
    const token4 = signup.body.token
    const socket = ioc(`http://localhost:${port}/blackjack`, { auth: { token: token4 }, transports: ['websocket'] })
    await new Promise((res, rej) => {
      socket.on('connect', res)
      socket.on('connect_error', rej)
    })

    // 루트 네임스페이스는 전혀 연결하지 않은 채(딥링크 재현) 게임 네임스페이스만으로도
    // walletEvents 브로드캐스트를 수신해야 한다.
    const balancePromise = new Promise((r) => socket.once('balance:update', r))
    applyTransaction(db, { userId, type: 'daily_bonus', amount: 1234 })
    const payload = await balancePromise
    expect(payload.balance).toBe(10000 + 1234)

    socket.close()
  })
})
