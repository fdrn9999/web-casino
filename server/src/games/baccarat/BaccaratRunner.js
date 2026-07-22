import { buildShoe } from '../cards.js'
import { playRound, betPayout, BET_KINDS } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

export class BaccaratRunner {
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
    this.players = new Map()
    this.bets = [] // { userId, nickname, kind, amount } — 같은 kind는 합산 보관
    this.betLog = [] // { userId, kind, amount } — 배치 1건 단위 기록(되돌리기용)
    this.result = null
    this.history = []
    this.shoe = []
    this.roundId = null
    this.rules_ = null
    this.settled = false
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  rules() {
    const s = getSettings(this.db, 'baccarat')
    const limits = this.table.limits_json ? JSON.parse(this.table.limits_json) : null
    return limits ? { ...s, ...limits } : s
  }

  playerCount() {
    return this.players.size
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

  snapshot() {
    const r = this.rules_ ?? this.rules()
    return {
      tableId: this.table.id,
      name: this.table.name,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      players: [...this.players.values()].map(({ nickname }) => ({ nickname })),
      bets: this.bets.map(({ nickname, kind, amount }) => ({ nickname, kind, amount })),
      result: this.result,
      history: this.history,
      rules: {
        minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds,
        revealSeconds: r.revealSeconds, tiePayout: r.tiePayout, pairPayout: r.pairPayout,
      },
    }
  }

  sit() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  leave() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }
  action() {
    return { error: '이 게임에는 좌석이 없습니다.' }
  }

  onJoin(userId, nickname) {
    this.players.set(userId, { nickname })
    if (this.phase === 'waiting') this.startBetting()
    this.onSeatsChange()
    this.broadcast()
  }

  onDisconnect(userId) {
    this.players.delete(userId)
    if (this.playerCount() === 0 && this.phase === 'betting' && this.bets.length === 0) this.goWaiting()
    this.onSeatsChange()
  }

  placeBet(userId, { kind, amount } = {}) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const player = this.players.get(userId)
    if (!player) return { error: '테이블에 먼저 입장하세요.' }
    if (!BET_KINDS.includes(kind)) return { error: '알 수 없는 베팅 종류입니다.' }
    if (!Number.isInteger(amount) || amount <= 0) {
      return { error: '베팅 금액이 올바르지 않습니다.' }
    }
    const r = this.rules_
    // 같은 kind에 대한 재베팅은 거부하지 않고 기존 베팅에 합산한다(룰렛과 동일한 누적 UX).
    // 최초 베팅은 minBet 이상이어야 하고, 누적 총액은 항상 maxBet 이하여야 한다.
    const existing = this.bets.find((b) => b.userId === userId && b.kind === kind)
    const newTotal = (existing?.amount ?? 0) + amount
    if (!existing && amount < r.minBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    if (newTotal > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, { userId, type: 'bet', amount: -amount, game: 'baccarat', refRoundId: this.roundId })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    if (existing) {
      existing.amount = newTotal
    } else {
      this.bets.push({ userId, nickname: player.nickname, kind, amount })
    }
    this.betLog.push({ userId, kind, amount })
    this.broadcast()
    return { ok: true }
  }

  // 내가 마지막으로 놓은 베팅 1건(합산 이전의 배치 단위)을 물리고 즉시 환불한다.
  undoBet(userId) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    for (let i = this.betLog.length - 1; i >= 0; i--) {
      if (this.betLog[i].userId !== userId) continue
      const [entry] = this.betLog.splice(i, 1)
      const bet = this.bets.find((b) => b.userId === userId && b.kind === entry.kind)
      if (bet) {
        bet.amount -= entry.amount
        if (bet.amount <= 0) this.bets = this.bets.filter((b) => b !== bet)
      }
      applyTransaction(this.db, {
        userId, type: 'payout', amount: entry.amount, game: 'baccarat',
        refRoundId: this.roundId, reason: '베팅 되돌리기 환불',
      })
      this.broadcast()
      return { ok: true, amount: entry.amount }
    }
    return { error: '되돌릴 베팅이 없습니다.' }
  }

  // 이번 라운드 내 베팅 전부를 취소하고 총액을 환불한다.
  clearBets(userId) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const mine = this.bets.filter((b) => b.userId === userId)
    if (mine.length === 0) return { error: '취소할 베팅이 없습니다.' }
    const total = mine.reduce((sum, b) => sum + b.amount, 0)
    this.bets = this.bets.filter((b) => b.userId !== userId)
    this.betLog = this.betLog.filter((e) => e.userId !== userId)
    applyTransaction(this.db, {
      userId, type: 'payout', amount: total, game: 'baccarat',
      refRoundId: this.roundId, reason: '베팅 취소 환불',
    })
    this.broadcast()
    return { ok: true, amount: total }
  }

  goWaiting() {
    this.phase = 'waiting'
    this.clearTimer()
    this.broadcast()
  }

  startBetting() {
    if (this.stopped) return
    if (this.playerCount() === 0) return this.goWaiting()
    this.rules_ = this.rules()
    this.phase = 'betting'
    this.bets = []
    this.result = null
    this.settled = false
    const { lastInsertRowid } = this.db.prepare("INSERT INTO rounds (game, table_id) VALUES ('baccarat', ?)").run(this.table.id)
    this.roundId = Number(lastInsertRowid)
    this.schedule(this.rules_.betSeconds * 1000, () => this.closeBetting())
    this.broadcast()
  }

  closeBetting() {
    if (this.bets.length === 0) {
      this.db.prepare('DELETE FROM rounds WHERE id = ?').run(this.roundId)
      this.roundId = null
      return this.startBetting()
    }
    if (this.shoe.length < 20) this.shoe = buildShoe(8, this.rng)
    this.result = playRound(this.shoe)
    this.phase = 'revealing'
    this.broadcast()
    this.schedule(this.rules_.revealSeconds * 1000, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.clearTimer()
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    const payoutByUser = new Map()
    for (const bet of this.bets) {
      const payout = betPayout(bet, this.result, this.rules_)
      insertBet.run(this.roundId, bet.userId, JSON.stringify({ kind: bet.kind }), bet.amount, payout)
      payoutByUser.set(bet.userId, (payoutByUser.get(bet.userId) ?? 0) + payout)
    }
    for (const [userId, payout] of payoutByUser) {
      if (payout > 0) {
        applyTransaction(this.db, { userId, type: 'payout', amount: payout, game: 'baccarat', refRoundId: this.roundId })
      }
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?").run(
      JSON.stringify({
        outcome: this.result.outcome,
        player: this.result.player.map((c) => c.code),
        banker: this.result.banker.map((c) => c.code),
      }),
      this.roundId
    )
    this.settled = true
    this.history.unshift(this.result.outcome)
    // 중국점(빅로드+파생 로드)을 그리려면 한 슈 분량의 기록이 필요하다 — 80판 보관
    this.history = this.history.slice(0, 80)
    this.broadcast()
    this.schedule(4000, () => this.startBetting())
  }

  refundAll() {
    for (const bet of this.bets) {
      applyTransaction(this.db, {
        userId: bet.userId, type: 'payout', amount: bet.amount, game: 'baccarat',
        refRoundId: this.roundId, reason: '테이블 중단 환불',
      })
    }
    this.bets = []
  }

  start() {
    if (this.playerCount() > 0) this.startBetting()
    else this.goWaiting()
  }

  stop({ refund = true } = {}) {
    this.stopped = true
    this.clearTimer()
    if (refund && !this.settled && this.bets.length > 0) this.refundAll()
    this.nsp.to(this.room).emit('table:closed', {})
  }
}
