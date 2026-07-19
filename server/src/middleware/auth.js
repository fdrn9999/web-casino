import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

const SAFE_USER_SQL = `SELECT id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at FROM users WHERE id = ?`

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

export function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return res.status(401).json({ error: '유효하지 않은 로그인입니다. 다시 로그인해 주세요.' })
    }
    const user = db.prepare(SAFE_USER_SQL).get(payload.sub)
    if (!user) return res.status(401).json({ error: '존재하지 않는 계정입니다.' })
    if (user.banned) return res.status(403).json({ error: `차단된 계정입니다. 사유: ${user.ban_reason || '미기재'}` })
    req.user = user
    next()
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '관리자 전용 기능입니다.' })
  next()
}
