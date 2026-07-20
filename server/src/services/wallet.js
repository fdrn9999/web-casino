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
  // balanceAfter는 내부 트랜잭션이 이미 커밋된 뒤의 확정 잔액이다. 이 호출이 외부
  // 트랜잭션(winJackpot·reconcile·블랙잭 정산) 안에서 실행될 때는 그 외부 트랜잭션이
  // 커밋되기 전에 이벤트가 나갈 수 있으나, 그 호출부들은 applyTransaction 이후 롤백 지점이
  // 없으므로(즉시 커밋으로 끝남) 브로드캐스트되는 값은 항상 최종값과 일치한다(불변식).
  walletEvents.emit('balance', { userId, balance: balanceAfter })
  return { balanceAfter }
}
