import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { io as ioc } from 'socket.io-client'
import request from 'supertest'
import { createDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { createSocketServer } from '../src/sockets/index.js'
import { applyTransaction } from '../src/services/wallet.js'

describe('socket 기본 네임스페이스', () => {
  let db, httpServer, port, token, userId

  beforeAll(async () => {
    db = createDb()
    const app = createApp(db)
    httpServer = createServer(app)
    createSocketServer(httpServer, db)
    await new Promise((r) => httpServer.listen(0, r))
    port = httpServer.address().port
    const res = await request(app).post('/api/auth/signup')
      .send({ username: 'sockuser', password: 'password1', nickname: '소켓', agreed: true })
    token = res.body.token
    userId = res.body.user.id
  })

  afterAll(() => new Promise((r) => httpServer.close(r)))

  it('유효한 토큰으로 접속되고 balance:update를 받는다', async () => {
    const socket = ioc(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] })
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve)
      socket.on('connect_error', reject)
    })
    const balancePromise = new Promise((r) => socket.once('balance:update', r))
    applyTransaction(db, { userId, type: 'daily_bonus', amount: 1000 })
    const payload = await balancePromise
    expect(payload.balance).toBe(11000)
    socket.close()
  })

  it('토큰 없이 접속하면 거부된다', async () => {
    const socket = ioc(`http://localhost:${port}`, { transports: ['websocket'] })
    const err = await new Promise((r) => socket.on('connect_error', r))
    expect(err).toBeTruthy()
    socket.close()
  })
})
