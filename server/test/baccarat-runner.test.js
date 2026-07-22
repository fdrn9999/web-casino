import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { BaccaratRunner } from '../src/games/baccarat/BaccaratRunner.js'

function makeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1
        pending.set(seq, fn)
        return seq
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fire() {
      const fns = [...pending.values()]
      pending.clear()
      fns.forEach((fn) => fn())
    },
  }
}

const fakeNsp = { to: () => ({ emit() {} }) }

describe('BaccaratRunner', () => {
  let db, t, table

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('b1', 'h', '바카라러', 10000)").run()
    db.prepare("INSERT INTO tables (game, name) VALUES ('baccarat', '바카라1')").run()
    table = { id: 1, game: 'baccarat', name: '바카라1', limits_json: null }
    t = makeTimers()
  })

  it('베팅: kind 검증, 알 수 없는 kind는 거부', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'tie', amount: 100 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'wat', amount: 100 }).error).toBeTruthy()
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9400)
  })

  it('같은 kind 재베팅은 거부 대신 기존 베팅에 합산된다(칩 스태킹)', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'player', amount: 300 }).ok).toBe(true)
    const bet = r.snapshot().bets.find((b) => b.kind === 'player')
    expect(bet.amount).toBe(800)
    // 지갑에서는 두 번의 베팅 금액(500 + 300)만큼만 차감되어야 한다.
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000 - 800)
    // bets 배열에는 kind당 하나의 항목만 존재해야 한다(중복 항목 없음).
    expect(r.snapshot().bets.filter((b) => b.kind === 'player').length).toBe(1)
  })

  it('누적 총액이 maxBet을 넘으면 거부되고, 초과분은 차감되지 않는다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'banker', amount: 9000 }).ok).toBe(true)
    const before = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance
    const res = r.placeBet(1, { kind: 'banker', amount: 2000 }) // 누적 11000 > maxBet(10000)
    expect(res.error).toBeTruthy()
    const after = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance
    expect(after).toBe(before) // 거부된 베팅은 지갑에서 차감되지 않는다
    expect(r.snapshot().bets.find((b) => b.kind === 'banker').amount).toBe(9000)
  })

  it('최초 베팅이 minBet 미만이면 거부되지만, 합산 시에는 minBet 재검증을 하지 않는다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'tie', amount: 50 }).error).toBeTruthy() // minBet(100) 미만
    expect(r.placeBet(1, { kind: 'tie', amount: 100 }).ok).toBe(true)
    // 이미 minBet을 만족했으므로 추가 소액(minBet 미만) 합산은 허용된다.
    expect(r.placeBet(1, { kind: 'tie', amount: 10 }).ok).toBe(true)
    expect(r.snapshot().bets.find((b) => b.kind === 'tie').amount).toBe(110)
  })

  it('풀 사이클: 마감 → 공개(결과 확정) → 정산 → 다음 베팅, 잔액 보존 불변식', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'player', amount: 1000 })
    r.placeBet(1, { kind: 'ppair', amount: 100 })
    t.fire() // 마감 → revealing
    const snap = r.snapshot()
    expect(snap.phase).toBe('revealing')
    expect(snap.result.player.length).toBeGreaterThanOrEqual(2)
    t.fire() // 정산 → result
    expect(r.snapshot().phase).toBe('result')
    const balance = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balance).toBe(10000 - 1100 + payoutSum)
    expect(r.snapshot().history.length).toBe(1)
    t.fire()
    expect(r.snapshot().phase).toBe('betting')
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'banker', amount: 700 })
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })
})
