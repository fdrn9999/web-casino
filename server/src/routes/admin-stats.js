import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

export function adminStatsRouter(db) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.get('/', (req, res) => {
    const days = Number(req.query.days ?? 30)
    const since = days > 0 ? `-${days} days` : '-100 years'
    const today = kstDateString()

    const totalsRow = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) AS totalWagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) AS totalPaid
      FROM transactions WHERE created_at >= datetime('now', ?)
    `).get(since)

    const totals = {
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      activeToday: db.prepare(
        "SELECT COUNT(DISTINCT user_id) c FROM transactions WHERE date(created_at, '+9 hours') = ?"
      ).get(today).c,
      totalWagered: totalsRow.totalWagered ?? 0,
      totalPaid: totalsRow.totalPaid ?? 0,
      houseNet: (totalsRow.totalWagered ?? 0) - (totalsRow.totalPaid ?? 0),
    }

    const daily = db.prepare(`
      SELECT date(created_at, '+9 hours') d,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid
      FROM transactions
      WHERE type IN ('bet', 'payout', 'jackpot') AND created_at >= datetime('now', ?)
      GROUP BY d ORDER BY d
    `).all(since)

    const byGame = db.prepare(`
      SELECT game,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END)
          - SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) net
      FROM transactions
      WHERE game IS NOT NULL AND created_at >= datetime('now', ?)
      GROUP BY game ORDER BY wagered DESC
    `).all(since)

    const reliefDaily = db.prepare(`
      SELECT date(created_at, '+9 hours') d, COUNT(*) count
      FROM transactions WHERE type = 'bankrupt_relief' AND created_at >= datetime('now', ?)
      GROUP BY d ORDER BY d
    `).all(since)

    const jackpotHistory = db.prepare(`
      SELECT u.nickname, t.amount, t.created_at
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE t.type = 'jackpot' ORDER BY t.id DESC LIMIT 20
    `).all()

    const topUsers = db.prepare(`
      SELECT nickname, username, total_wagered, total_won, total_won - total_wagered AS net
      FROM users WHERE role = 'user' ORDER BY total_wagered DESC LIMIT 10
    `).all()

    res.json({ totals, daily, byGame, reliefDaily, jackpotHistory, topUsers })
  })

  return r
}
