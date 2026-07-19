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

  it('여러 유저의 미정산 라운드를 한번에 환불+종료하고, 재실행 시 이중환불 없이 멱등하다', () => {
    const db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u1', 'h', '유저1', 10000)").run()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('u2', 'h', '유저2', 5000)").run()
    const { lastInsertRowid: roundId } = db.prepare("INSERT INTO rounds (game) VALUES ('blackjack')").run()
    applyTransaction(db, { userId: 1, type: 'bet', amount: -3000, game: 'blackjack', refRoundId: Number(roundId) })
    applyTransaction(db, { userId: 2, type: 'bet', amount: -1500, game: 'blackjack', refRoundId: Number(roundId) })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(7000)
    expect(db.prepare('SELECT balance FROM users WHERE id = 2').get().balance).toBe(3500)

    // 원자적으로 두 유저 모두 환불되고 라운드가 종료 처리되어야 한다 (한 트랜잭션 커밋 단위)
    const count = reconcileUnfinishedRounds(db)
    expect(count).toBe(2)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
    expect(db.prepare('SELECT balance FROM users WHERE id = 2').get().balance).toBe(5000)
    expect(db.prepare('SELECT ended_at FROM rounds WHERE id = ?').get(roundId).ended_at).toBeTruthy()

    // 재실행(예: 크래시 후 재부팅 시뮬레이션) 시 라운드가 ended_at IS NULL 조건에서 제외되어
    // 0건 환불되고 잔액도 그대로여야 한다 (이중환불 방지)
    expect(reconcileUnfinishedRounds(db)).toBe(0)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
    expect(db.prepare('SELECT balance FROM users WHERE id = 2').get().balance).toBe(5000)
  })
})
