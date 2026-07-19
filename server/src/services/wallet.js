import { EventEmitter } from 'node:events'

export const walletEvents = new EventEmitter()
walletEvents.setMaxListeners(0)

export class InsufficientBalanceError extends Error {
  constructor() {
    super('칩이 부족합니다.')
    this.name = 'InsufficientBalanceError'
  }
}

export function applyTransaction(db, { userId, type, amount, game = null, refRoundId = null, reason = null }) {
  const balanceAfter = db.transaction(() => {
    const user = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(userId)
    if (!user) throw new Error('존재하지 않는 유저입니다.')
    const next = user.balance + amount
    if (next < 0) throw new InsufficientBalanceError()
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId)
    if (type === 'bet') {
      db.prepare('UPDATE users SET total_wagered = total_wagered + ? WHERE id = ?').run(Math.abs(amount), userId)
    }
    if (type === 'payout' || type === 'jackpot') {
      db.prepare('UPDATE users SET total_won = total_won + ? WHERE id = ?').run(amount, userId)
    }
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, balance_after, game, ref_round_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, type, amount, next, game, refRoundId, reason)
    return next
  })()
  walletEvents.emit('balance', { userId, balance: balanceAfter })
  return { balanceAfter }
}
