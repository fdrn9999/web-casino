import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'
import { applyTransaction } from '../src/services/wallet.js'
import { reconcileUnfinishedRounds } from '../src/services/reconcile.js'

describe('reconcile', () => {
  it('미정산 라운드의 베팅을 환불하고 라운드를 종료 처리한다', () => {
    const db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', 10000)").run()
    const { lastInsertRowid: roundId } = db.prepare("INSERT INTO rounds (game) VALUES ('blackjack')").run()
    applyTransaction(db, { userId: 1, type: 'bet', amount: -3000, game: 'blackjack', refRoundId: Number(roundId) })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(7000)

    const count = reconcileUnfinishedRounds(db)
    expect(count).toBe(1)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
    expect(db.prepare('SELECT ended_at FROM rounds WHERE id = ?').get(roundId).ended_at).toBeTruthy()
    // 재실행해도 이중 환불 없음
    expect(reconcileUnfinishedRounds(db)).toBe(0)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })

  it('정산 완료된 라운드는 건드리지 않는다', () => {
    const db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저', 10000)").run()
    const { lastInsertRowid: roundId } = db
      .prepare("INSERT INTO rounds (game, ended_at) VALUES ('slots', datetime('now'))").run()
    applyTransaction(db, { userId: 1, type: 'bet', amount: -500, game: 'slots', refRoundId: Number(roundId) })
    expect(reconcileUnfinishedRounds(db)).toBe(0)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9500)
  })
})
