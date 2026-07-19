import { Server } from 'socket.io'
import { verifyToken } from '../middleware/auth.js'
import { walletEvents } from '../services/wallet.js'
import { jackpotEvents } from '../services/jackpot.js'

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
  })

  jackpotEvents.on('pool', ({ pool }) => io.emit('jackpot:pool', { pool }))
  jackpotEvents.on('won', ({ nickname, amount }) => io.emit('jackpot:won', { nickname, amount }))

  return io
}

export function disconnectUser(io, userId, reason = '') {
  io.to(`user:${userId}`).emit('session:banned', { reason })
  io.in(`user:${userId}`).disconnectSockets(true)
}
