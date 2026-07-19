import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export function meStatsRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/', (req, res) => {
    const u = req.user
    const totals = {
      totalWagered: u.total_wagered,
      totalWon: u.total_won,
      net: u.total_won - u.total_wagered,
      bankruptCount: u.bankrupt_count,
    }
    const daily = db.prepare(`
      SELECT date(created_at, '+9 hours') d,
        SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) wagered,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END) paid,
        SUM(CASE WHEN type IN ('payout', 'jackpot') THEN amount ELSE 0 END)
          - SUM(CASE WHEN type = 'bet' THEN -amount ELSE 0 END) net
      FROM transactions
      WHERE user_id = ? AND type IN ('bet', 'payout', 'jackpot')
        AND created_at >= datetime('now', '-30 days')
      GROUP BY d ORDER BY d
    `).all(u.id)
    const recent = db.prepare(
      'SELECT type, amount, game, reason, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).all(u.id)
    res.json({ totals, daily, recent })
  })

  return r
}
