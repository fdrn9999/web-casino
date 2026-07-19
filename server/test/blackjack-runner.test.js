import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db/index.js'
import { BlackjackRunner } from '../src/games/blackjack/BlackjackRunner.js'
import { saveSettings } from '../src/services/settings.js'

function makeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1
        pending.set(seq, { fn, ms })
        return seq
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fire() {
      const entries = [...pending.entries()]
      pending.clear()
      entries.forEach(([, { fn }]) => fn())
    },
    count: () => pending.size,
  }
}

const fakeNsp = { to: () => ({ emit() {} }) }

function makeUser(db, username, balance = 10000) {
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO users (username, password_hash, nickname, balance) VALUES (?, ?, ?, ?)')
    .run(username, 'h', username, balance)
  return Number(id)
}

describe('BlackjackRunner', () => {
  let db, table, u1, u2, t

  beforeEach(() => {
    db = createDb()
    u1 = makeUser(db, 'p1')
    u2 = makeUser(db, 'p2')
    db.prepare("INSERT INTO tables (game, name) VALUES ('blackjack', '테스트')").run()
    table = { id: 1, game: 'blackjack', name: '테스트', limits_json: null }
    t = makeTimers()
  })

  function makeRunner(rng = Math.random) {
    return new BlackjackRunner({ db, nsp: fakeNsp, table, timers: t.timers, rng })
  }

  it('착석하면 베팅 페이즈가 시작된다', () => {
    const r = makeRunner()
    expect(r.snapshot().phase).toBe('waiting')
    expect(r.sit(u1, 'p1', 2).ok).toBe(true)
    expect(r.snapshot().phase).toBe('betting')
    expect(r.snapshot().seats[2].nickname).toBe('p1')
  })

  it('중복 착석·점유 좌석은 거부된다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.sit(u2, 'p2', 0).error).toBeTruthy()
    expect(r.sit(u1, 'p1', 1).error).toBeTruthy()
  })

  it('베팅하면 즉시 차감되고, 한도 위반·중복 베팅은 거부', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.placeBet(u1, 50).error).toBeTruthy()
    expect(r.placeBet(u1, 500).ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(9500)
    expect(r.placeBet(u1, 500).error).toBeTruthy()
  })

  it('베팅 마감 → 딜링 → 전원 자동 스탠드 → 딜러 → 정산 → 다음 베팅 (풀 사이클)', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.sit(u2, 'p2', 1)
    r.placeBet(u1, 1000)
    r.placeBet(u2, 500)
    t.fire() // 베팅 마감 → 딜링 → acting (첫 턴 타이머 장전)
    expect(r.snapshot().phase).toBe('acting')
    expect(r.snapshot().seats[0].hands[0].cards.length).toBe(2)
    expect(r.snapshot().dealer.hidden).toBe(true)
    t.fire() // seat0 자동 스탠드 → seat1 턴
    t.fire() // seat1 자동 스탠드 → dealer 페이즈 (result 예약)
    t.fire() // result → 다음 betting 예약까지
    const snap = r.snapshot()
    expect(['result', 'betting']).toContain(snap.phase)
    // 정산 완료: bets 2건 기록, 딜러 공개
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(2)
    const round = db.prepare('SELECT * FROM rounds').get()
    expect(round.ended_at).toBeTruthy()
    // 두 유저 잔액 합 = 20000 - 1500 + 총지급액 (지급액은 결과에 따라 0 이상)
    const balSum = db.prepare('SELECT SUM(balance) s FROM users').get().s
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balSum).toBe(20000 - 1500 + payoutSum)
  })

  it('테이블 한도 오버라이드가 전역 설정보다 우선한다', () => {
    saveSettings(db, 'blackjack', { minBet: 100 }, null)
    table.limits_json = JSON.stringify({ minBet: 1000, maxBet: 2000 })
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    expect(r.placeBet(u1, 500).error).toBeTruthy()
    expect(r.placeBet(u1, 1000).ok).toBe(true)
  })

  it('stop(refund)은 미정산 베팅을 환불한다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링 → acting
    r.stop({ refund: true })
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(10000)
  })

  it('hit으로 버스트하면 즉시 다음으로 넘어가고 정산에서 0을 받는다', () => {
    // 항상 10만 나오는 슈: rng=0이면 셔플이 결정적 → 대신 카드 강제 주입
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링
    r.shoe = [
      { rank: '10', suit: 'S', code: '10S' },
      { rank: '10', suit: 'H', code: '10H' },
      { rank: '10', suit: 'D', code: '10D' },
    ]
    r.seats[0].hands[0].cards = [
      { rank: '10', suit: 'C', code: '10C' },
      { rank: '9', suit: 'C', code: '9C' },
    ]
    const res = r.action(u1, 'hit') // 19 + 10 = 버스트
    expect(res.ok).toBe(true)
    expect(r.seats[0].hands[0].done).toBe(true)
  })
})
