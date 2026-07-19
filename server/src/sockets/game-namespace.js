import { verifyToken } from '../middleware/auth.js'
import { getRunner } from '../games/registry.js'
import { sanitizeMessage, RateLimiter } from '../games/chat.js'

export function attachGameNamespace(io, db, gameKey) {
  const nsp = io.of(`/${gameKey}`)
  const chatLimiter = new RateLimiter(2000)

  nsp.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token)
      const user = db.prepare('SELECT id, nickname, banned FROM users WHERE id = ?').get(payload.sub)
      if (!user || user.banned) return next(new Error('인증에 실패했습니다.'))
      socket.data.userId = user.id
      socket.data.nickname = user.nickname
      next()
    } catch {
      next(new Error('인증에 실패했습니다.'))
    }
  })

  nsp.on('connection', (socket) => {
    const runner = () => getRunner(socket.data.tableId)

    socket.on('table:join', ({ tableId } = {}, cb = () => {}) => {
      const row = db.prepare("SELECT * FROM tables WHERE id = ? AND game = ? AND status = 'open'").get(tableId, gameKey)
      const r = getRunner(tableId)
      if (!row || !r) return cb({ error: '입장할 수 없는 테이블입니다.' })
      socket.data.tableId = Number(tableId)
      socket.join(`table:${tableId}`)
      r.onJoin?.(socket.data.userId, socket.data.nickname)
      cb({ state: r.snapshot() })
    })

    socket.on('seat:join', ({ seat } = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.sit(socket.data.userId, socket.data.nickname, seat) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('seat:leave', (arg, maybeCb) => {
      const cb = typeof arg === 'function' ? arg : (maybeCb ?? (() => {}))
      const r = runner()
      cb(r ? r.leave(socket.data.userId) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('bet:place', (payload = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.placeBet(socket.data.userId, payload) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('action', ({ move } = {}, cb = () => {}) => {
      const r = runner()
      cb(r ? r.action(socket.data.userId, move) : { error: '테이블에 먼저 입장하세요.' })
    })

    socket.on('chat:send', ({ text } = {}, cb = () => {}) => {
      const tableId = socket.data.tableId
      if (!tableId) return cb({ error: '테이블에 먼저 입장하세요.' })

      const sanitized = sanitizeMessage(text)
      if (!sanitized.ok) return cb({ error: sanitized.error })

      if (!chatLimiter.allow(socket.data.userId)) {
        return cb({ error: '메시지를 너무 빨리 보내고 있습니다.' })
      }

      nsp.to(`table:${tableId}`).emit('chat:message', {
        nickname: socket.data.nickname,
        text: sanitized.text,
        at: Date.now(),
      })
      cb({ ok: true })
    })

    socket.on('disconnect', () => {
      runner()?.onDisconnect(socket.data.userId)
    })
  })

  return nsp
}
