import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { BaccaratRunner } from '../src/games/baccarat/BaccaratRunner.js'
import { RouletteRunner } from '../src/games/roulette/RouletteRunner.js'
import { BlackjackRunner } from '../src/games/blackjack/BlackjackRunner.js'

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

function balanceOf(db, id) {
  return db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance
}

describe('베팅 되돌리기/전체 취소 — RouletteRunner', () => {
  let db, t, table

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('r1', 'h', '룰렛러', 10000)").run()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('r2', 'h', '옆사람', 10000)").run()
    db.prepare("INSERT INTO tables (game, name) VALUES ('roulette', '룰렛1')").run()
    table = { id: 1, game: 'roulette', name: '룰렛1', limits_json: null }
    t = makeTimers()
  })

  it('undoBet: 마지막 베팅 1건만 물리고 그 금액을 환불한다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '룰렛러')
    r.placeBet(1, { type: 'red', amount: 500 })
    r.placeBet(1, { type: 'inside', numbers: [7], amount: 300 })
    expect(balanceOf(db, 1)).toBe(9200)

    const res = r.undoBet(1)
    expect(res.ok).toBe(true)
    expect(res.amount).toBe(300)
    expect(balanceOf(db, 1)).toBe(9500)
    expect(r.snapshot().bets.length).toBe(1)
    expect(r.snapshot().bets[0].type).toBe('red')
  })

  it('undoBet: 되돌릴 베팅이 없으면 에러, 다른 유저의 베팅은 건드리지 않는다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '룰렛러')
    r.onJoin(2, '옆사람')
    r.placeBet(2, { type: 'black', amount: 700 })

    expect(r.undoBet(1).error).toBeTruthy()
    expect(r.snapshot().bets.length).toBe(1)
    expect(balanceOf(db, 2)).toBe(9300)
  })

  it('clearBets: 내 베팅 전부 취소·총액 환불, 남의 베팅은 유지', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '룰렛러')
    r.onJoin(2, '옆사람')
    r.placeBet(1, { type: 'red', amount: 500 })
    r.placeBet(1, { type: 'odd', amount: 200 })
    r.placeBet(2, { type: 'black', amount: 700 })

    const res = r.clearBets(1)
    expect(res.ok).toBe(true)
    expect(res.amount).toBe(700)
    expect(balanceOf(db, 1)).toBe(10000)
    expect(balanceOf(db, 2)).toBe(9300)
    expect(r.snapshot().bets.length).toBe(1)
    expect(r.snapshot().bets[0].nickname).toBe('옆사람')
  })

  it('베팅 페이즈가 아니면 undo/clear 모두 거부한다', () => {
    const r = new RouletteRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '룰렛러')
    r.placeBet(1, { type: 'red', amount: 500 })
    t.fire() // closeBetting → spinning
    expect(r.snapshot().phase).toBe('spinning')
    expect(r.undoBet(1).error).toBeTruthy()
    expect(r.clearBets(1).error).toBeTruthy()
    expect(balanceOf(db, 1)).toBe(9500)
  })
})

describe('베팅 되돌리기/전체 취소 — BaccaratRunner', () => {
  let db, t, table

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('b1', 'h', '바카라러', 10000)").run()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('b2', 'h', '옆사람', 10000)").run()
    db.prepare("INSERT INTO tables (game, name) VALUES ('baccarat', '바카라1')").run()
    table = { id: 1, game: 'baccarat', name: '바카라1', limits_json: null }
    t = makeTimers()
  })

  it('undoBet: 합산된 kind에서 마지막 배치분만 물리고 환불한다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'player', amount: 500 })
    r.placeBet(1, { kind: 'player', amount: 300 }) // 합산 800
    expect(r.snapshot().bets.find((b) => b.kind === 'player').amount).toBe(800)

    const res = r.undoBet(1)
    expect(res.ok).toBe(true)
    expect(res.amount).toBe(300)
    expect(r.snapshot().bets.find((b) => b.kind === 'player').amount).toBe(500)
    expect(balanceOf(db, 1)).toBe(9500)
  })

  it('undoBet: 배치분을 전부 물리면 해당 kind 항목 자체가 사라진다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'tie', amount: 100 })
    expect(r.undoBet(1).ok).toBe(true)
    expect(r.snapshot().bets.length).toBe(0)
    expect(balanceOf(db, 1)).toBe(10000)
    expect(r.undoBet(1).error).toBeTruthy() // 더 물릴 것이 없음
  })

  it('clearBets: 여러 kind에 걸친 내 베팅 전부 취소·총액 환불, 남의 베팅은 유지', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.onJoin(2, '옆사람')
    r.placeBet(1, { kind: 'player', amount: 500 })
    r.placeBet(1, { kind: 'ppair', amount: 100 })
    r.placeBet(2, { kind: 'banker', amount: 900 })

    const res = r.clearBets(1)
    expect(res.ok).toBe(true)
    expect(res.amount).toBe(600)
    expect(balanceOf(db, 1)).toBe(10000)
    expect(balanceOf(db, 2)).toBe(9100)
    expect(r.snapshot().bets.length).toBe(1)
    expect(r.snapshot().bets[0].kind).toBe('banker')
  })

  it('clear 후 재베팅과 정산이 정상 동작한다(betLog 정합성)', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'player', amount: 500 })
    r.clearBets(1)
    r.placeBet(1, { kind: 'banker', amount: 1000 })
    expect(balanceOf(db, 1)).toBe(9000)
    t.fire() // 마감 → revealing
    t.fire() // 정산 → result
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balanceOf(db, 1)).toBe(9000 + payoutSum)
    // 정산에 반영된 베팅은 취소 후 다시 건 banker 1건뿐이어야 한다
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(1)
  })

  it('베팅 페이즈가 아니면 undo/clear 모두 거부한다', () => {
    const r = new BaccaratRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.onJoin(1, '바카라러')
    r.placeBet(1, { kind: 'player', amount: 500 })
    t.fire() // 마감 → revealing
    expect(r.snapshot().phase).toBe('revealing')
    expect(r.undoBet(1).error).toBeTruthy()
    expect(r.clearBets(1).error).toBeTruthy()
  })
})

describe('블랙잭 즉시 누적 베팅 + 되돌리기/전체취소 + 떠나기 잠금 — BlackjackRunner', () => {
  let db, t, table

  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('bj1', 'h', '블랙잭러', 10000)").run()
    db.prepare("INSERT INTO tables (game, name) VALUES ('blackjack', '블랙잭1')").run()
    table = { id: 1, game: 'blackjack', name: '블랙잭1', limits_json: null }
    t = makeTimers()
  })

  it('placeBet가 확정 없이 즉시 누적된다(칩을 얹을 때마다 합산·즉시 차감)', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    expect(r.snapshot().phase).toBe('betting')
    expect(r.placeBet(1, { amount: 500 }).ok).toBe(true)
    expect(r.placeBet(1, { amount: 300 }).ok).toBe(true) // 누적 800
    const seat = r.snapshot().seats.find((s) => s)
    expect(seat.bet).toBe(800)
    expect(balanceOf(db, 1)).toBe(9200)
  })

  it('undoBet: 마지막 칩만 물리고 환불, clearBets: 전부 취소·총액 환불', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    r.placeBet(1, { amount: 500 })
    r.placeBet(1, { amount: 300 })
    const undo = r.undoBet(1)
    expect(undo.ok).toBe(true)
    expect(undo.amount).toBe(300)
    expect(r.snapshot().seats.find((s) => s).bet).toBe(500)
    expect(balanceOf(db, 1)).toBe(9500)

    const clr = r.clearBets(1)
    expect(clr.ok).toBe(true)
    expect(clr.amount).toBe(500)
    expect(r.snapshot().seats.find((s) => s).bet).toBe(0)
    expect(balanceOf(db, 1)).toBe(10000)
    expect(r.undoBet(1).error).toBeTruthy() // 더 물릴 것 없음
  })

  it('첫 칩이 minBet 미만이면 거부되지만, 누적 후 소액 추가는 허용된다', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    expect(r.placeBet(1, { amount: 50 }).error).toBeTruthy() // minBet(100) 미만
    expect(r.placeBet(1, { amount: 100 }).ok).toBe(true)
    expect(r.placeBet(1, { amount: 10 }).ok).toBe(true) // 이미 minBet 충족 → 소액 추가 허용
    expect(r.snapshot().seats.find((s) => s).bet).toBe(110)
  })

  it('칩을 올린 뒤에는 수동으로 떠날 수 없다(떠나기 불가), 베팅 전에는 가능', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    r.placeBet(1, { amount: 500 })
    expect(r.leave(1).error).toBeTruthy() // 라운드 참여 중 — 이탈 불가
    expect(r.snapshot().seats.find((s) => s?.userId === 1)).toBeTruthy() // 여전히 착석
    // 전체 취소로 베팅을 비우면 다시 떠날 수 있다
    r.clearBets(1)
    expect(r.leave(1).ok).toBe(true)
    expect(r.snapshot().seats.every((s) => s === null)).toBe(true)
  })

  it('시간 종료 시 얹어 둔 칩으로 자동으로 라운드가 시작된다(확정 버튼 없음)', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    r.placeBet(1, { amount: 500 }) // 확정 호출 없음
    t.fire() // 베팅 시간 종료 → closeBetting 자동 딜
    const phase = r.snapshot().phase
    expect(['acting', 'dealer', 'result']).toContain(phase) // 자동으로 라운드 진행됨
    const seat = r.snapshot().seats.find((s) => s)
    expect(seat.hands.length).toBeGreaterThanOrEqual(1) // 카드가 딜됨
  })

  it('연결 끊김은 라운드 중이어도 좌석을 유지(정산 후 정리)하되, 베팅 전이면 즉시 비운다', () => {
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    // 베팅 전 disconnect → 즉시 좌석 비움 → waiting
    r.onDisconnect(1)
    expect(r.snapshot().seats.every((s) => s === null)).toBe(true)
  })

  it('베팅 창 전체를 보내고도 칩을 올리지 않으면 마감 시 좌석이 비워진다', () => {
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('bj2', 'h', '옆자리', 10000)").run()
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0) // 창 시작부터 착석
    r.sit(2, '옆자리', 1) // 같은 창에서 착석·베팅함
    r.placeBet(2, { amount: 500 })
    t.fire() // 베팅 마감 → 미베팅 좌석(1) 비움 + 라운드 진행
    expect(r.snapshot().seats[0]).toBeNull() // 미베팅자 좌석 비워짐
    expect(r.snapshot().seats[1]).not.toBeNull() // 베팅자는 라운드 진행
    expect(['acting', 'dealer', 'result']).toContain(r.snapshot().phase)
  })

  it('베팅 창 중간에 앉은 유저는 그 창 마감에는 비워지지 않는다(다음 창까지 유예)', () => {
    db.prepare("INSERT INTO users (username, password_hash, nickname, balance) VALUES ('bj2', 'h', '옆자리', 10000)").run()
    const r = new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers })
    r.sit(1, '블랙잭러', 0)
    r.placeBet(1, { amount: 500 })
    // 창이 이미 진행 중일 때(startBetting 이후) 늦게 착석 — bettingWindowIds에 없음
    r.sit(2, '옆자리', 1)
    t.fire() // 마감: 늦게 앉은 유저는 미베팅이어도 유예
    expect(r.snapshot().seats[1]).not.toBeNull()
  })
})
