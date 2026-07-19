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

  it('베팅: kind 검증, 같은 kind 중복 거부', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'player', amount: 500 }).error).toBeTruthy()
    expect(r.placeBet(1, { kind: 'tie', amount: 100 }).ok).toBe(true)
    expect(r.placeBet(1, { kind: 'wat', amount: 100 }).error).toBeTruthy()
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9400)
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
