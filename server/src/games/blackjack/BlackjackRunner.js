import { buildShoe, drawCard } from '../cards.js'
import { handValue, isBlackjack, isBust, dealerShouldHit, settleHand } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

const SEAT_COUNT = 7

export class BlackjackRunner {
  constructor({ db, nsp, table, timers = null, rng = Math.random, onSeatsChange = () => {} }) {
    this.db = db
    this.nsp = nsp
    this.table = table
    this.timers = timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    }
    this.rng = rng
    this.onSeatsChange = onSeatsChange
    this.room = `table:${table.id}`
    this.phase = 'waiting'
    this.seats = Array(SEAT_COUNT).fill(null)
    this.dealerCards = []
    this.dealerHidden = true
    this.shoe = []
    this.roundId = null
    this.rules_ = null
    this.currentSeat = -1
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  // ── 유틸 ──────────────────────────────────────────────
  rules() {
    const s = getSettings(this.db, 'blackjack')
    const limits = this.table.limits_json ? JSON.parse(this.table.limits_json) : null
    return limits ? { ...s, ...limits } : s
  }

  playerCount() {
    return this.seats.filter(Boolean).length
  }

  seatOf(userId) {
    return this.seats.findIndex((s) => s?.userId === userId)
  }

  broadcast() {
    this.nsp.to(this.room).emit('table:state', this.snapshot())
  }

  schedule(ms, fn) {
    this.clearTimer()
    this.phaseEndsAt = Date.now() + ms
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      if (!this.stopped) fn()
    }, ms)
  }

  clearTimer() {
    if (this.timer != null) {
      this.timers.clearTimeout(this.timer)
      this.timer = null
    }
    this.phaseEndsAt = null
  }

  // 라운드 도중 슈가 소진되는 병적인 경우(장기 라운드) 대비: 필요 시 즉시 재구성 후 드로우.
  drawSafe() {
    if (this.shoe.length === 0) this.shoe = buildShoe(this.rules_.decks, this.rng)
    return drawCard(this.shoe)
  }

  snapshot() {
    const r = this.rules_ ?? this.rules()
    return {
      tableId: this.table.id,
      name: this.table.name,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      currentSeat: this.currentSeat,
      dealer: {
        cards: this.dealerCards.map((c, i) =>
          this.dealerHidden && i === 1 ? { code: 'BACK' } : c
        ),
        total: this.dealerHidden ? null : handValue(this.dealerCards).total,
        hidden: this.dealerHidden,
      },
      seats: this.seats.map((s) =>
        s
          ? {
              userId: s.userId,
              nickname: s.nickname,
              bet: s.bet,
              activeHand: s.activeHand,
              hands: s.hands.map((h) => ({
                cards: h.cards,
                ...handValue(h.cards),
                doubled: h.doubled,
                surrendered: h.surrendered,
                done: h.done,
                result: h.result ?? null,
              })),
            }
          : null
      ),
      rules: {
        minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds, turnSeconds: r.turnSeconds,
        surrenderAllowed: r.surrenderAllowed, doubleAllowed: r.doubleAllowed, splitAllowed: r.splitAllowed,
      },
    }
  }

  // ── 착석/이탈 ─────────────────────────────────────────
  sit(userId, nickname, seatIdx) {
    if (this.stopped) return { error: '테이블이 종료되었습니다.' }
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= SEAT_COUNT) return { error: '잘못된 좌석입니다.' }
    if (this.seats[seatIdx]) return { error: '이미 다른 플레이어가 앉아 있습니다.' }
    if (this.seatOf(userId) !== -1) return { error: '이미 착석 중입니다.' }
    this.seats[seatIdx] = { userId, nickname, bet: 0, staked: 0, hands: [], activeHand: 0, leaving: false }
    if (this.phase === 'waiting') this.startBetting()
    this.onSeatsChange()
    this.broadcast()
    return { ok: true }
  }

  leave(userId) {
    const idx = this.seatOf(userId)
    if (idx === -1) return { error: '착석 중이 아닙니다.' }
    const seat = this.seats[idx]
    const inRound = seat.bet > 0 && ['betting', 'acting', 'dealer', 'result'].includes(this.phase)
    if (inRound) {
      seat.leaving = true
      if (this.phase === 'acting' && this.currentSeat === idx) this.autoStand()
    } else {
      this.seats[idx] = null
      if (this.playerCount() === 0) this.goWaiting()
    }
    this.onSeatsChange()
    this.broadcast()
    return { ok: true }
  }

  onDisconnect(userId) {
    if (this.seatOf(userId) !== -1) this.leave(userId)
  }

  // ── 베팅 ──────────────────────────────────────────────
  placeBet(userId, payload) {
    const amount = typeof payload === 'number' ? payload : payload?.amount
    if (this.stopped) return { error: '테이블이 종료되었습니다.' }
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const idx = this.seatOf(userId)
    if (idx === -1) return { error: '먼저 좌석에 앉아 주세요.' }
    const seat = this.seats[idx]
    if (seat.bet > 0) return { error: '이미 베팅했습니다.' }
    const r = this.rules_
    if (!Number.isInteger(amount) || amount < r.minBet || amount > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, {
        userId, type: 'bet', amount: -amount, game: 'blackjack', refRoundId: this.roundId,
      })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    seat.bet = amount
    seat.staked = amount
    this.broadcast()
    return { ok: true }
  }

  // ── 페이즈 전이 ───────────────────────────────────────
  goWaiting() {
    this.phase = 'waiting'
    this.clearTimer()
    this.currentSeat = -1
    this.broadcast()
  }

  startBetting() {
    if (this.stopped) return
    if (this.playerCount() === 0) return this.goWaiting()
    this.rules_ = this.rules() // 라운드 시작 시점 규칙 고정 (다음 라운드부터 반영 규칙)
    this.phase = 'betting'
    this.dealerCards = []
    this.dealerHidden = true
    this.currentSeat = -1
    for (const seat of this.seats.filter(Boolean)) {
      seat.bet = 0
      seat.staked = 0
      seat.hands = []
      seat.activeHand = 0
    }
    const { lastInsertRowid } = this.db.prepare(
      "INSERT INTO rounds (game, table_id) VALUES ('blackjack', ?)"
    ).run(this.table.id)
    this.roundId = Number(lastInsertRowid)
    this.schedule(this.rules_.betSeconds * 1000, () => this.closeBetting())
    this.broadcast()
  }

  closeBetting() {
    const bettingSeats = this.seats.filter((s) => s?.bet > 0)
    if (bettingSeats.length === 0) {
      this.db.prepare('DELETE FROM rounds WHERE id = ?').run(this.roundId)
      this.roundId = null
      return this.startBetting() // 착석자가 있으면 다음 베팅 창, 없으면 waiting
    }
    // 슈 확인
    const needed = this.rules_.decks * 52 * 0.25
    if (this.shoe.length < needed) this.shoe = buildShoe(this.rules_.decks, this.rng)
    // 딜링: 각 좌석 2장, 딜러 2장(2번째 히든)
    for (const seat of bettingSeats) {
      seat.hands = [{ cards: [this.drawSafe(), this.drawSafe()], doubled: false, surrendered: false, done: false, fromSplit: false }]
      seat.activeHand = 0
    }
    this.dealerCards = [this.drawSafe(), this.drawSafe()]
    this.dealerHidden = true
    // 딜러 블랙잭이면 즉시 공개·정산
    if (isBlackjack(this.dealerCards)) {
      for (const seat of bettingSeats) {
        for (const hand of seat.hands) hand.done = true
      }
      this.phase = 'dealer'
      this.dealerHidden = false
      this.broadcast()
      return this.schedule(1500, () => this.settleRound())
    }
    // 블랙잭인 플레이어는 자동 완료
    for (const seat of bettingSeats) {
      if (isBlackjack(seat.hands[0].cards)) seat.hands[0].done = true
    }
    this.phase = 'acting'
    this.currentSeat = -1
    this.broadcast()
    this.advanceTurn()
  }

  advanceTurn() {
    // 현재 좌석에 남은 핸드가 있으면 그 핸드로, 아니면 다음 좌석으로
    for (let i = Math.max(this.currentSeat, 0); i < SEAT_COUNT; i++) {
      const seat = this.seats[i]
      if (!seat || seat.bet === 0) continue
      const handIdx = seat.hands.findIndex((h) => !h.done)
      if (handIdx !== -1) {
        this.currentSeat = i
        seat.activeHand = handIdx
        this.schedule(this.rules_.turnSeconds * 1000, () => this.autoStand())
        this.broadcast()
        return
      }
    }
    this.dealerPhase()
  }

  autoStand() {
    const seat = this.seats[this.currentSeat]
    if (seat) {
      const hand = seat.hands[seat.activeHand]
      if (hand && !hand.done) hand.done = true
    }
    this.advanceTurn()
  }

  currentHand(userId) {
    const idx = this.seatOf(userId)
    if (this.phase !== 'acting' || idx !== this.currentSeat) return null
    const seat = this.seats[idx]
    return { seat, hand: seat.hands[seat.activeHand] }
  }

  action(userId, move) {
    if (this.stopped) return { error: '테이블이 종료되었습니다.' }
    const cur = this.currentHand(userId)
    if (!cur) return { error: '지금은 행동할 수 없습니다.' }
    const { seat, hand } = cur
    const r = this.rules_
    const firstAction = hand.cards.length === 2 && !hand.doubled

    if (move === 'hit') {
      hand.cards.push(this.drawSafe())
      if (handValue(hand.cards).total >= 21) hand.done = true
    } else if (move === 'stand') {
      hand.done = true
    } else if (move === 'double') {
      if (!r.doubleAllowed || !firstAction) return { error: '지금은 더블할 수 없습니다.' }
      const extra = hand.doubled ? 0 : seat.bet
      try {
        applyTransaction(this.db, { userId, type: 'bet', amount: -extra, game: 'blackjack', refRoundId: this.roundId })
      } catch (e) {
        if (e instanceof InsufficientBalanceError) return { error: e.message }
        throw e
      }
      seat.staked += extra
      hand.doubled = true
      hand.cards.push(this.drawSafe())
      hand.done = true
    } else if (move === 'split') {
      if (!r.splitAllowed || seat.hands.length > 1 || !firstAction) return { error: '지금은 스플릿할 수 없습니다.' }
      if (hand.cards[0].rank !== hand.cards[1].rank) return { error: '같은 숫자 카드만 스플릿할 수 있습니다.' }
      try {
        applyTransaction(this.db, { userId, type: 'bet', amount: -seat.bet, game: 'blackjack', refRoundId: this.roundId })
      } catch (e) {
        if (e instanceof InsufficientBalanceError) return { error: e.message }
        throw e
      }
      seat.staked += seat.bet
      const [c1, c2] = hand.cards
      seat.hands = [
        { cards: [c1, this.drawSafe()], doubled: false, surrendered: false, done: false, fromSplit: true },
        { cards: [c2, this.drawSafe()], doubled: false, surrendered: false, done: false, fromSplit: true },
      ]
      seat.activeHand = 0
    } else if (move === 'surrender') {
      if (!r.surrenderAllowed || !firstAction || seat.hands.length > 1) return { error: '지금은 서렌더할 수 없습니다.' }
      hand.surrendered = true
      hand.done = true
    } else {
      return { error: '알 수 없는 행동입니다.' }
    }

    if (hand.done || move === 'split') {
      if (seat.hands.every((h) => h.done)) this.advanceTurn()
      else {
        seat.activeHand = seat.hands.findIndex((h) => !h.done)
        this.schedule(r.turnSeconds * 1000, () => this.autoStand())
      }
    } else {
      this.schedule(r.turnSeconds * 1000, () => this.autoStand())
    }
    this.broadcast()
    return { ok: true }
  }

  dealerPhase() {
    this.phase = 'dealer'
    this.currentSeat = -1
    this.dealerHidden = false
    const anyLive = this.seats.some(
      (s) => s?.bet > 0 && s.hands.some((h) => !h.surrendered && !isBust(h.cards))
    )
    if (anyLive) {
      while (dealerShouldHit(this.dealerCards, this.rules_.hitSoft17)) {
        this.dealerCards.push(this.drawSafe())
      }
    }
    this.broadcast()
    this.schedule(1500, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.dealerHidden = false
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    for (const seat of this.seats.filter((s) => s?.bet > 0)) {
      let totalPayout = 0
      for (const hand of seat.hands) {
        const handBet = hand.doubled ? seat.bet * 2 : seat.bet
        const { payout, outcome } = settleHand({
          playerCards: hand.cards,
          dealerCards: this.dealerCards,
          bet: handBet,
          surrendered: hand.surrendered,
          fromSplit: hand.fromSplit,
          rules: this.rules_,
        })
        hand.result = { payout, outcome }
        totalPayout += payout
      }
      if (totalPayout > 0) {
        applyTransaction(this.db, {
          userId: seat.userId, type: 'payout', amount: totalPayout, game: 'blackjack', refRoundId: this.roundId,
        })
      }
      insertBet.run(this.roundId, seat.userId, JSON.stringify({ bet: seat.bet, hands: seat.hands.length }), seat.staked, totalPayout)
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?").run(
      JSON.stringify({ dealer: this.dealerCards.map((c) => c.code) }),
      this.roundId
    )
    // 떠나기로 한 좌석 정리
    this.seats = this.seats.map((s) => (s?.leaving ? null : s))
    this.onSeatsChange()
    this.broadcast()
    this.schedule(5000, () => this.startBetting())
  }

  refundAll() {
    for (const seat of this.seats.filter((s) => s?.staked > 0)) {
      const settled = seat.hands.some((h) => h.result)
      if (!settled) {
        applyTransaction(this.db, {
          userId: seat.userId, type: 'payout', amount: seat.staked, game: 'blackjack',
          refRoundId: this.roundId, reason: '테이블 중단 환불',
        })
        seat.staked = 0
        seat.bet = 0
      }
    }
  }

  start() {
    if (this.playerCount() > 0) this.startBetting()
    else this.goWaiting()
  }

  stop({ refund = true } = {}) {
    this.stopped = true
    this.clearTimer()
    if (refund && ['betting', 'acting', 'dealer'].includes(this.phase)) this.refundAll()
    this.nsp.to(this.room).emit('table:closed', {})
  }
}
