import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export function leaderboardRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/', (req, res) => {
    const richest = db.prepare(`
      SELECT nickname, username, balance FROM users
      WHERE role = 'user' ORDER BY balance DESC LIMIT 10
    `).all()

    const biggestWins = db.prepare(`
      SELECT u.nickname, t.amount, t.game, t.created_at
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE t.type IN ('payout', 'jackpot')
      ORDER BY t.amount DESC LIMIT 10
    `).all()

    const biggestLosers = db.prepare(`
      SELECT nickname, total_wagered - total_won AS netLoss FROM users
      WHERE role = 'user' AND total_wagered > total_won
      ORDER BY netLoss DESC LIMIT 10
    `).all()

    res.json({ richest, biggestWins, biggestLosers })
  })

  return r
}
