import { EventEmitter } from 'node:events'
import { applyTransaction } from './wallet.js'

export const jackpotEvents = new EventEmitter()
jackpotEvents.setMaxListeners(0)

export function ensureJackpot(db, seed) {
  db.prepare('INSERT OR IGNORE INTO jackpot (id, pool, seed) VALUES (1, ?, ?)').run(seed, seed)
  return getJackpot(db)
}

export function getJackpot(db) {
  return db.prepare('SELECT * FROM jackpot WHERE id = 1').get()
}

export function contributeJackpot(db, betAmount, rate) {
  const add = Math.floor(betAmount * rate)
  if (add > 0) db.prepare('UPDATE jackpot SET pool = pool + ? WHERE id = 1').run(add)
  const { pool } = getJackpot(db)
  if (add > 0) jackpotEvents.emit('pool', { pool })
  return pool
}

export function winJackpot(db, userId) {
  const amount = db.transaction(() => {
    const { pool, seed } = getJackpot(db)
    db.prepare(
      "UPDATE jackpot SET pool = seed, last_winner_id = ?, last_won_amount = ?, last_won_at = datetime('now') WHERE id = 1"
    ).run(userId, pool)
    applyTransaction(db, { userId, type: 'jackpot', amount: pool, game: 'slots', reason: '프로그레시브 잭팟 당첨' })
    return pool
  })()
  const { nickname } = db.prepare('SELECT nickname FROM users WHERE id = ?').get(userId)
  jackpotEvents.emit('pool', { pool: getJackpot(db).pool })
  jackpotEvents.emit('won', { userId, nickname, amount })
  return amount
}
