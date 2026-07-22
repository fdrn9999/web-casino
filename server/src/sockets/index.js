import { Server } from 'socket.io'
import { verifyToken } from '../middleware/auth.js'
import { walletEvents } from '../services/wallet.js'
import { jackpotEvents } from '../services/jackpot.js'
import { attachGameNamespace } from './game-namespace.js'
import { GAME_KEYS } from '../services/tables.js'

export function createSocketServer(httpServer, db) {
  const io = new Server(httpServer)

  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token)
      const user = db.prepare('SELECT id, banned FROM users WHERE id = ?').get(payload.sub)
      if (!user || user.banned) return next(new Error('인증에 실패했습니다.'))
      socket.data.userId = user.id
      next()
    } catch {
      next(new Error('인증에 실패했습니다.'))
    }
  })

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`)
  })

  walletEvents.on('balance', ({ userId, balance }) => {
    io.to(`user:${userId}`).emit('balance:update', { balance })
    // 게임 네임스페이스(/blackjack 등) 소켓은 루트 네임스페이스를 구독하지 않으므로
    // session:banned와 동일한 패턴으로 각 게임 네임스페이스에도 재전파한다.
    for (const gameKey of GAME_KEYS) {
      io.of('/' + gameKey).to(`user:${userId}`).emit('balance:update', { balance })
    }
  })

  jackpotEvents.on('pool', ({ pool }) => io.emit('jackpot:pool', { pool }))
  jackpotEvents.on('won', ({ nickname, amount }) => io.emit('jackpot:won', { nickname, amount }))

  for (const gameKey of GAME_KEYS) attachGameNamespace(io, db, gameKey)

  return io
}

export function disconnectUser(io, userId, reason = '') {
  io.to(`user:${userId}`).emit('session:banned', { reason })
  io.in(`user:${userId}`).disconnectSockets(true)

  for (const gameKey of GAME_KEYS) {
    const nsp = io.of('/' + gameKey)
    nsp.to(`user:${userId}`).emit('session:banned', { reason })
    nsp.in(`user:${userId}`).disconnectSockets(true)
  }
}
