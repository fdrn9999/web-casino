import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { ensureJackpot, getJackpot, contributeJackpot, winJackpot, jackpotEvents } from '../src/services/jackpot.js'

describe('jackpot', () => {
  let db
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('j1', 'h', '잭팟러', 0)").run()
    ensureJackpot(db, 50000)
  })

  it('초기 풀은 시드와 같다', () => {
    expect(getJackpot(db).pool).toBe(50000)
  })

  it('적립은 베팅액×비율의 내림값이며 pool 이벤트가 나간다', () => {
    let ev = null
    jackpotEvents.once('pool', (p) => (ev = p))
    const pool = contributeJackpot(db, 1000, 0.01)
    expect(pool).toBe(50010)
    expect(ev.pool).toBe(50010)
  })

  it('당첨 시 전액 지급되고 풀이 시드로 리셋된다', () => {
    contributeJackpot(db, 10000, 0.01)
    let won = null
    jackpotEvents.once('won', (p) => (won = p))
    const amount = winJackpot(db, 1)
    expect(amount).toBe(50100)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(50100)
    expect(getJackpot(db).pool).toBe(50000)
    expect(getJackpot(db).last_winner_id).toBe(1)
    expect(won.nickname).toBe('잭팟러')
    expect(won.amount).toBe(50100)
  })
})
