import { validateBet, spinResult, betPayout, colorOf } from './engine.js'
import { applyTransaction, InsufficientBalanceError } from '../../services/wallet.js'
import { getSettings } from '../../services/settings.js'

const MAX_BETS_PER_USER = 20

export class RouletteRunner {
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
    this.players = new Map() // userId → { nickname }
    this.bets = [] // { userId, nickname, type, numbers, amount }
    this.result = null
    this.history = []
    this.roundId = null
    this.rules_ = null
    this.settled = false
    this.phaseEndsAt = null
    this.timer = null
    this.stopped = false
  }

  rules() {
    const s = getSettings(this.db, 'roulette')
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
      bets: this.bets.map(({ nickname, type, numbers, amount }) => ({ nickname, type, numbers, amount })),
      result: this.result,
      history: this.history,
      rules: { minBet: r.minBet, maxBet: r.maxBet, betSeconds: r.betSeconds, spinSeconds: r.spinSeconds },
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

  placeBet(userId, payload = {}) {
    if (this.phase !== 'betting') return { error: '지금은 베팅 시간이 아닙니다.' }
    const player = this.players.get(userId)
    if (!player) return { error: '테이블에 먼저 입장하세요.' }
    if (this.bets.filter((b) => b.userId === userId).length >= MAX_BETS_PER_USER) {
      return { error: '한 라운드 베팅 개수 한도를 넘었습니다.' }
    }
    const err = validateBet(payload)
    if (err) return { error: err }
    const { amount } = payload
    const r = this.rules_
    if (!Number.isInteger(amount) || amount < r.minBet || amount > r.maxBet) {
      return { error: `베팅은 ${r.minBet}~${r.maxBet}칩 정수여야 합니다.` }
    }
    try {
      applyTransaction(this.db, { userId, type: 'bet', amount: -amount, game: 'roulette', refRoundId: this.roundId })
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return { error: e.message }
      throw e
    }
    this.bets.push({ userId, nickname: player.nickname, type: payload.type, numbers: payload.numbers ?? null, amount })
    this.broadcast()
    return { ok: true }
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
    const { lastInsertRowid } = this.db.prepare("INSERT INTO rounds (game, table_id) VALUES ('roulette', ?)").run(this.table.id)
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
    this.result = spinResult(this.rng)
    this.phase = 'spinning'
    this.broadcast()
    this.schedule(this.rules_.spinSeconds * 1000, () => this.settleRound())
  }

  settleRound() {
    this.phase = 'result'
    this.clearTimer()
    const insertBet = this.db.prepare(
      'INSERT INTO bets (round_id, user_id, bet_json, amount, payout) VALUES (?, ?, ?, ?, ?)'
    )
    const payoutByUser = new Map()
    for (const bet of this.bets) {
      const payout = betPayout(bet, bet.amount, this.result)
      insertBet.run(this.roundId, bet.userId, JSON.stringify({ type: bet.type, numbers: bet.numbers }), bet.amount, payout)
      payoutByUser.set(bet.userId, (payoutByUser.get(bet.userId) ?? 0) + payout)
    }
    for (const [userId, payout] of payoutByUser) {
      if (payout > 0) {
        applyTransaction(this.db, { userId, type: 'payout', amount: payout, game: 'roulette', refRoundId: this.roundId })
      }
    }
    this.db.prepare("UPDATE rounds SET result_json = ?, ended_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ n: this.result }), this.roundId)
    this.settled = true
    this.history.unshift({ n: this.result, color: colorOf(this.result) })
    this.history = this.history.slice(0, 20)
    this.broadcast()
    this.schedule(4000, () => this.startBetting())
  }

  refundAll() {
    for (const bet of this.bets) {
      applyTransaction(this.db, {
        userId: bet.userId, type: 'payout', amount: bet.amount, game: 'roulette',
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
