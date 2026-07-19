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

  // 기본 rng를 결정적 상수로: 딜러/플레이어 내추럴 블랙잭이 무작위로 발생해
  // 페이즈 전이 단언이 간헐 실패하는 것을 막는다(카드를 직접 강제하는 테스트에는 무해).
  function makeRunner(rng = () => 0.1) {
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
    // rng 고정: 딜러/플레이어 내추럴 블랙잭·21이 없는 결정적 딜(p1=16,p2=15,딜러=19)이라
    // 페이즈 전이(acting→...) 단언이 간헐 실패하지 않는다.
    const r = makeRunner(() => 0.1)
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

  it('베팅 후 이탈해도 칩이 소멸되지 않는다', () => {
    // rng 고정: 내추럴 블랙잭 없는 결정적 딜로 페이즈 단언 안정화(칩 보존 단언은 그대로).
    const r = makeRunner(() => 0.1)
    r.sit(u1, 'p1', 0)
    r.sit(u2, 'p2', 1)
    r.placeBet(u1, 1000)
    r.placeBet(u2, 500)
    expect(r.snapshot().phase).toBe('betting')
    // 베팅 완료 후, 베팅 페이즈 도중 이탈 시도 (칩은 이미 차감된 상태)
    expect(r.leave(u1).ok).toBe(true)
    // 좌석은 즉시 비워지지 않고 leaving 플래그만 세팅되어 라운드에 계속 참여해야 한다
    expect(r.seats[0]).not.toBeNull()
    expect(r.seats[0].leaving).toBe(true)

    t.fire() // 베팅 마감 → 딜링 → acting (첫 턴 타이머 장전)
    expect(r.snapshot().phase).toBe('acting')
    t.fire() // 첫 좌석 자동 스탠드(이탈자, 응답 없음) → 다음 좌석 턴
    t.fire() // 마지막 좌석 자동 스탠드 → dealer 페이즈 (result 예약)
    t.fire() // 정산 실행 → 다음 betting 예약까지

    // 정산 완료: bets 2건 기록 (이탈자 포함, 정상 정산됨)
    expect(db.prepare('SELECT COUNT(*) c FROM bets').get().c).toBe(2)
    // 칩 보존: 두 유저 잔액 합 = 20000 - 1500(베팅액) + 총지급액
    const balSum = db.prepare('SELECT SUM(balance) s FROM users').get().s
    const payoutSum = db.prepare('SELECT SUM(payout) s FROM bets').get().s
    expect(balSum).toBe(20000 - 1500 + payoutSum)
    // 이탈 신청한 좌석은 정산 후 비워진다
    expect(r.seats[0]).toBeNull()
  })

  it('더블하면 추가 베팅만큼 차감되고 2배 스테이크로 정산된다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링 → acting
    // 자연 블랙잭 등 경쟁 상태를 배제하기 위해 결정적 상태로 강제 재지정
    r.clearTimer()
    r.phase = 'acting'
    r.currentSeat = 0
    r.dealerHidden = true
    r.dealerCards = [
      { rank: '10', suit: 'S', code: '10S' },
      { rank: '9', suit: 'H', code: '9H' },
    ] // 19, hitSoft17=false이므로 추가 드로우 없음
    r.seats[0].hands = [{
      cards: [
        { rank: '5', suit: 'C', code: '5C' },
        { rank: '6', suit: 'C', code: '6C' },
      ],
      doubled: false, surrendered: false, done: false, fromSplit: false,
    }]
    r.seats[0].activeHand = 0
    r.shoe = [{ rank: '9', suit: 'D', code: '9D' }] // 더블 드로우용 카드 1장

    const balAfterBet = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    const res = r.action(u1, 'double')
    expect(res.ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(balAfterBet - 1000) // 추가 베팅 차감
    expect(r.seats[0].hands[0].doubled).toBe(true)
    expect(r.seats[0].hands[0].done).toBe(true)
    expect(r.snapshot().phase).toBe('dealer')

    t.fire() // settleRound
    expect(r.seats[0].hands[0].result.outcome).toBe('win')
    expect(r.seats[0].hands[0].result.payout).toBe(4000) // handBet 2000 × 2배(승리)
    const finalBal = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    expect(finalBal).toBe(balAfterBet - 1000 + 4000)
  })

  it('스플릿하면 두 개의 핸드가 생기고 추가 스테이크가 차감되며 각각 정산된다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 1000)
    t.fire() // 딜링 → acting
    // 자연 블랙잭 등 경쟁 상태를 배제하기 위해 결정적 상태로 강제 재지정
    r.clearTimer()
    r.phase = 'acting'
    r.currentSeat = 0
    r.dealerHidden = true
    r.dealerCards = [
      { rank: '10', suit: 'S', code: '10S' },
      { rank: '5', suit: 'H', code: '5H' },
    ] // 15, 이후 딜러가 1장 더 뽑아 17로 정지
    r.seats[0].hands = [{
      cards: [
        { rank: '8', suit: 'C', code: '8C' },
        { rank: '8', suit: 'H', code: '8H' },
      ],
      doubled: false, surrendered: false, done: false, fromSplit: false,
    }]
    r.seats[0].activeHand = 0
    r.shoe = [
      { rank: '9', suit: 'D', code: '9D' }, // 두 번째 drawSafe 호출(핸드1)에 사용
      { rank: '9', suit: 'S', code: '9S' }, // 첫 번째 drawSafe 호출(핸드0)에 사용
    ]

    const balAfterBet = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    const res = r.action(u1, 'split')
    expect(res.ok).toBe(true)
    expect(db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance).toBe(balAfterBet - 1000) // 추가 스테이크 차감
    expect(r.seats[0].hands.length).toBe(2)
    expect(r.seats[0].hands[0].fromSplit).toBe(true)
    expect(r.seats[0].hands[1].fromSplit).toBe(true)
    expect(r.seats[0].hands[0].cards.length).toBe(2)
    expect(r.seats[0].hands[1].cards.length).toBe(2)
    // 두 핸드 모두 8+9=17 (딜러가 1장 더 뽑도록 준비)
    r.shoe = [{ rank: '2', suit: 'C', code: '2C' }]
    r.action(u1, 'stand') // 핸드0 완료 → 핸드1 턴
    r.action(u1, 'stand') // 핸드1 완료 → dealerPhase (딜러 15 → 2C 드로우 → 17)
    expect(r.snapshot().phase).toBe('dealer')

    t.fire() // settleRound
    // 딜러 17, 두 핸드 모두 17 → 푸시(원금 반환) × 2
    expect(r.seats[0].hands[0].result.outcome).toBe('push')
    expect(r.seats[0].hands[1].result.outcome).toBe('push')
    const finalBal = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    expect(finalBal).toBe(balAfterBet - 1000 + 2000) // 스테이크 2000 전액 반환(푸시)
  })

  it('서렌더하면 베팅의 절반이 즉시 반환된다', () => {
    const r = makeRunner()
    r.sit(u1, 'p1', 0)
    r.placeBet(u1, 999) // 홀수 베팅으로 floor() 동작 확인
    t.fire() // 딜링 → acting
    // 자연 블랙잭 등 경쟁 상태를 배제하기 위해 결정적 상태로 강제 재지정
    r.clearTimer()
    r.phase = 'acting'
    r.currentSeat = 0
    r.dealerHidden = true
    r.dealerCards = [
      { rank: '10', suit: 'S', code: '10S' },
      { rank: '9', suit: 'H', code: '9H' },
    ]
    r.seats[0].hands = [{
      cards: [
        { rank: '9', suit: 'C', code: '9C' },
        { rank: '7', suit: 'C', code: '7C' },
      ],
      doubled: false, surrendered: false, done: false, fromSplit: false,
    }]
    r.seats[0].activeHand = 0

    const balAfterBet = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    const res = r.action(u1, 'surrender')
    expect(res.ok).toBe(true)
    expect(r.seats[0].hands[0].surrendered).toBe(true)
    expect(r.seats[0].hands[0].done).toBe(true)
    expect(r.snapshot().phase).toBe('dealer') // 유일한 좌석이므로 즉시 딜러 페이즈로

    t.fire() // settleRound
    expect(r.seats[0].hands[0].result.outcome).toBe('surrender')
    expect(r.seats[0].hands[0].result.payout).toBe(Math.floor(999 / 2)) // 499
    const finalBal = db.prepare('SELECT balance FROM users WHERE id = ?').get(u1).balance
    expect(finalBal).toBe(balAfterBet + Math.floor(999 / 2))
  })
})
