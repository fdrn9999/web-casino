import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { RouletteRunner } from '../src/games/roulette/RouletteRunner.js'

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

describe('RouletteRunner', () => {
  let db, t, table, u1

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('r1', 'h', '룰렛러', 10000)").run()
    u1 = 1
    db.prepare("INSERT INTO tables (game, name) VALUES ('roulette', '룰렛1')").run()
    table = { id: 1, game: 'roulette', name: '룰렛1', limits_json: null }
    t = makeTimers()
  })

  it('참가하면 베팅이 시작되고, 좌석 이벤트는 거부된다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    expect(r.snapshot().phase).toBe('betting')
    expect(r.playerCount()).toBe(1)
    expect(r.sit(u1, '룰렛러', 0).error).toBeTruthy()
  })

  it('베팅: 즉시 차감, 검증 실패는 거부, 여러 베팅 허용', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    expect(r.placeBet(u1, { type: 'red', amount: 500 }).ok).toBe(true)
    expect(r.placeBet(u1, { type: 'inside', numbers: [7], amount: 100 }).ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(9400)
    expect(r.placeBet(u1, { type: 'inside', numbers: [1, 2], amount: 50 }).error).toBeTruthy() // 최소 미달
    expect(r.placeBet(u1, { type: 'nope', amount: 500 }).error).toBeTruthy()
  })

  it('풀 사이클: 마감 → 스핀(결과 확정) → 정산 → 다음 베팅. 7 스트레이트 적중 시 3600 지급', () => {
    const rng = () => 7 / 37 + 0.001 // spinResult → 7
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers, rng })
    r.onJoin(u1, '룰렛러')
    r.placeBet(u1, { type: 'inside', numbers: [7], amount: 100 })
    t.fire() // 베팅 마감 → spinning
    expect(r.snapshot().phase).toBe('spinning')
    expect(r.snapshot().result).toBe(7)
    t.fire() // settle → result
    expect(r.snapshot().phase).toBe('result')
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000 - 100 + 3600)
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(1)
    expect(r.snapshot().history[0]).toEqual({ n: 7, color: 'red' })
    t.fire() // 다음 betting
    expect(r.snapshot().phase).toBe('betting')
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    r.placeBet(u1, { type: 'red', amount: 1000 })
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance).toBe(10000)
  })

  it('한 유저당 한 라운드 20베팅 초과 시 21번째 베팅은 거부된다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(u1, '룰렛러')
    for (let i = 0; i < 20; i++) {
      expect(r.placeBet(u1, { type: 'red', amount: 100 }).ok).toBe(true)
    }
    expect(r.placeBet(u1, { type: 'red', amount: 100 }).error).toBeTruthy()
  })
})
