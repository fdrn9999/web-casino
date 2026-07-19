import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { disconnectUser } from '../sockets/index.js'

const SAFE_FIELDS = `id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at`

export function adminUsersRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.get('/', (req, res) => {
    const q = `%${req.query.q ?? ''}%`
    const users = db.prepare(
      `SELECT ${SAFE_FIELDS} FROM users WHERE username LIKE ? OR nickname LIKE ?
       ORDER BY created_at DESC LIMIT 100`
    ).all(q, q)
    res.json({ users })
  })

  r.get('/:id', (req, res) => {
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
    if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' })
    const transactions = db.prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    ).all(user.id)
    res.json({ user, transactions })
  })

  function loadUser(req, res) {
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id)
    if (!user) res.status(404).json({ error: '유저를 찾을 수 없습니다.' })
    return user
  }

  r.post('/:id/grant', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const { amount, reason } = req.body ?? {}
    if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: '지급액은 1 이상의 정수여야 합니다.' })
    if (!reason?.trim()) return res.status(400).json({ error: '사유를 입력해야 합니다.' })
    const { balanceAfter } = applyTransaction(db, {
      userId: user.id, type: 'admin_grant', amount, reason: reason.trim(),
    })
    res.json({ balance: balanceAfter })
  })

  r.post('/:id/confiscate', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const { amount, reason } = req.body ?? {}
    if (!reason?.trim()) return res.status(400).json({ error: '사유를 입력해야 합니다.' })
    const take = amount === 'all' ? user.balance : amount
    if (!Number.isInteger(take) || take < 1) return res.status(400).json({ error: "몰수액은 1 이상의 정수 또는 'all'이어야 합니다." })
    const clamped = Math.min(take, user.balance)
    if (clamped === 0) return res.json({ balance: user.balance })
    const { balanceAfter } = applyTransaction(db, {
      userId: user.id, type: 'admin_confiscate', amount: -clamped, reason: reason.trim(),
    })
    res.json({ balance: balanceAfter })
  })

  r.post('/:id/ban', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    const reason = (req.body?.reason ?? '').trim()
    if (!reason) return res.status(400).json({ error: '차단 사유를 입력해야 합니다.' })
    if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 차단할 수 없습니다.' })
    db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?').run(reason, user.id)
    if (ctx.io) disconnectUser(ctx.io, user.id, reason)
    res.json({ ok: true })
  })

  r.post('/:id/unban', (req, res) => {
    const user = loadUser(req, res)
    if (!user) return
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?').run(user.id)
    res.json({ ok: true })
  })

  return r
}
