import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { applyTransaction, InsufficientBalanceError } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { getJackpot, contributeJackpot, winJackpot } from '../services/jackpot.js'
import { spin, evaluate, PAYTABLE } from '../games/slots/engine.js'

export function slotsRouter(db, { rng = Math.random } = {}) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/state', (req, res) => {
    const s = getSettings(db, 'slots')
    res.json({
      settings: { minBet: s.minBet, maxBet: s.maxBet, betStep: s.betStep },
      pool: getJackpot(db).pool,
      paytable: PAYTABLE.map(({ match, label, multiplier }) => ({ match, label, multiplier })),
    })
  })

  r.post('/spin', (req, res) => {
    const s = getSettings(db, 'slots')
    const bet = req.body?.bet
    if (!Number.isInteger(bet) || bet < s.minBet || bet > s.maxBet || bet % s.betStep !== 0) {
      return res.status(400).json({ error: `베팅은 ${s.minBet}~${s.maxBet}칩, ${s.betStep}칩 단위여야 합니다.` })
    }

    const { lastInsertRowid: roundId } = db.prepare("INSERT INTO rounds (game) VALUES ('slots')").run()
    let balance
    try {
      balance = applyTransaction(db, {
        userId: req.user.id, type: 'bet', amount: -bet, game: 'slots', refRoundId: roundId,
      }).balanceAfter
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return res.status(400).json({ error: e.message })
      throw e
    }

    contributeJackpot(db, bet, s.jackpotRate)
    const symbols = spin(rng)
    const result = evaluate(symbols, bet)

    if (result.payout > 0) {
      balance = applyTransaction(db, {
        userId: req.user.id, type: 'payout', amount: result.payout, game: 'slots', refRoundId: roundId,
      }).balanceAfter
    }

    let jackpotAmount = 0
    if (result.isJackpot) {
      jackpotAmount = winJackpot(db, req.user.id)
      balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id).balance
    }

    db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ symbols, ...result, jackpotAmount }), roundId)
    db.prepare('INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)')
      .run(roundId, req.user.id, JSON.stringify({ bet }), bet, result.payout + jackpotAmount)

    res.json({
      symbols,
      payout: result.payout,
      multiplier: result.multiplier,
      label: result.label,
      jackpotWon: result.isJackpot,
      jackpotAmount,
      balance,
      pool: getJackpot(db).pool,
    })
  })

  return r
}
