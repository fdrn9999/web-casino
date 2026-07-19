import { applyTransaction } from './wallet.js'

export function reconcileUnfinishedRounds(db) {
  const rounds = db.prepare('SELECT id FROM rounds WHERE ended_at IS NULL').all()
  let refunded = 0
  for (const { id } of rounds) {
    const stakes = db.prepare(`
      SELECT user_id, SUM(-amount) staked FROM transactions
      WHERE ref_round_id = ? AND type = 'bet' GROUP BY user_id
    `).all(id)
    for (const { user_id, staked } of stakes) {
      if (staked > 0) {
        applyTransaction(db, {
          userId: user_id, type: 'payout', amount: staked, refRoundId: id, reason: '서버 중단 환불',
        })
        refunded += 1
      }
    }
    db.prepare(`UPDATE rounds SET ended_at = datetime('now'), result_json = '{"aborted":true}' WHERE id = ?`).run(id)
  }
  return refunded
}
