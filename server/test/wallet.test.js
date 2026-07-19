import { describe, it, expect, vi } from 'vitest'
import { createDb } from '../src/db/index.js'
import { applyTransaction, walletEvents, InsufficientBalanceError } from '../src/services/wallet.js'

function userDb(balance = 0) {
  const db = createDb()
  db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', ?)").run(balance)
  return db
}

describe('wallet.applyTransaction', () => {
  it('지급 시 잔액이 증가하고 거래가 기록된다', () => {
    const db = userDb(0)
    const { balanceAfter } = applyTransaction(db, { userId: 1, type: 'signup_bonus', amount: 10000 })
    expect(balanceAfter).toBe(10000)
    const tx = db.prepare('SELECT * FROM transactions WHERE user_id = 1').get()
    expect(tx.type).toBe('signup_bonus')
    expect(tx.amount).toBe(10000)
    expect(tx.balance_after).toBe(10000)
  })

  it('잔액 부족이면 throw하고 아무것도 변하지 않는다', () => {
    const db = userDb(500)
    expect(() => applyTransaction(db, { userId: 1, type: 'bet', amount: -1000, game: 'slots' }))
      .toThrow(InsufficientBalanceError)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(500)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
  })

  it('bet은 total_wagered, payout은 total_won에 누적된다', () => {
    const db = userDb(1000)
    applyTransaction(db, { userId: 1, type: 'bet', amount: -300, game: 'slots' })
    applyTransaction(db, { userId: 1, type: 'payout', amount: 600, game: 'slots' })
    const u = db.prepare('SELECT * FROM users WHERE id = 1').get()
    expect(u.total_wagered).toBe(300)
    expect(u.total_won).toBe(600)
    expect(u.balance).toBe(1300)
  })

  it('성공 시 balance 이벤트를 발행한다', () => {
    const db = userDb(0)
    const spy = vi.fn()
    walletEvents.once('balance', spy)
    applyTransaction(db, { userId: 1, type: 'daily_bonus', amount: 1000 })
    expect(spy).toHaveBeenCalledWith({ userId: 1, balance: 1000 })
  })

  it('없는 유저면 throw한다', () => {
    const db = createDb()
    expect(() => applyTransaction(db, { userId: 99, type: 'daily_bonus', amount: 1000 })).toThrow()
  })
})
