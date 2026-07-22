import { Container, Graphics, Text } from 'pixi.js'
import { Scene } from '../Scene'
import { CardSprite } from '../objects/CardSprite'
import { loadCardTextures, fullDeckCodes } from '../assets'
import { chipStyleFor } from '../../lib/chips'
import { onTap } from '../input'
import { toShoe } from '../easing'
import { burst } from '../objects/particles'

// 블랙잭 Pixi 씬 — BlackjackView.vue의 "순차 공개(progressive reveal) 큐"를 1:1 이식한 표현 계층.
// 서버 스냅샷(table:state)이 유일한 진실이며, 여기서는 카드 스프라이트의 "언제 보여줄지"만 지연한다.
// 뷰와의 역할 분담: 카드 딜/플립 사운드는 이 씬이(applyStep), 승패/셔플 사운드·플로팅·칩샤워는 뷰가 담당.
const SEAT_COUNT = 7
const OUTCOME_LABELS = {
  blackjack: '블랙잭!', win: '승리', push: '무승부', lose: '패배', bust: '버스트', surrender: '서렌더',
}
const WIN_OUTCOMES = new Set(['win', 'blackjack'])

export class BlackjackScene extends Scene {
  constructor(ctx, { myUserId = null, onSit = () => {} } = {}) {
    super(ctx)
    this.myUserId = myUserId
    this.onSit = onSit
    this.state = null // 마지막으로 처리한 서버 스냅샷(디스패치 기준)
    // reveal 미러: 화면에 이미 보여준 카드 스프라이트만 담는 지연 레이어(뷰의 revealedDealer/Seats와 동형)
    this.revealedDealer = [] // CardSprite[]
    this.revealedSeats = [] // (null | { hands: [{ sprites: CardSprite[] }] })[]
    this.planned = { dealerLen: 0, dealerFlipQueued: false, seats: [] }
    this.queue = []
    this.timerH = null
    this._flights = new Set() // 슈로 날아가는 카드 트윈들(파괴 시 취소)
    this._destroyed = false
    this._shuffling = false
  }

  async preload() {
    await loadCardTextures(fullDeckCodes())
  }

  build() {
    this.felt = new Graphics()
    this.archText = new Text({
      text: 'BLACKJACK PAYS 3:2',
      style: { fill: 0xf59e0b, fontSize: 15, fontWeight: '800', letterSpacing: 2 },
    })
    this.archText.anchor.set(0.5)
    this.subText = new Text({ text: '딜러는 17에서 반드시 멈춘다', style: { fill: 0x34d399, fontSize: 10 } })
    this.subText.anchor.set(0.5)
    this.subText.alpha = 0.7

    this.shoeLayer = this._buildShoe()
    this.dealerCards = new Container()
    this.dealerInfo = new Container()
    this.seatCards = Array.from({ length: SEAT_COUNT }, () => new Container())
    this.decor = new Container() // 좌석 플레이트/텍스트 — 스냅샷마다 재구성
    this.fxLayer = new Container() // 슈로 회수되는 카드 등 일회성 연출

    this.root.addChild(
      this.felt, this.archText, this.subText, this.decor, this.dealerInfo,
      this.dealerCards, ...this.seatCards, this.fxLayer, this.shoeLayer
    )

    // 셔플 리플(슈에서 카드가 튀어나왔다 돌아가는 루프) + 활성 좌석 펄스
    this._animT = 0
    this.ticker((t) => {
      this._animT += t.deltaMS
      this._animateRiffle()
      if (this._activeHl && !this._activeHl.destroyed) {
        this._activeHl.alpha = 0.55 + 0.35 * Math.sin(this._animT / 180)
      }
    })
  }

  _buildShoe() {
    const c = new Container()
    const base = new Graphics()
    base.roundRect(-13, -17, 26, 34, 3).fill(0x7f1d1d).stroke({ width: 2, color: 0xffffff, alpha: 0.75 })
    const label = new Text({ text: 'SHOE', style: { fill: 0x34d399, fontSize: 8, fontWeight: '700', letterSpacing: 2 } })
    label.anchor.set(0.5)
    label.y = 28
    label.alpha = 0.7
    this._riffle = []
    for (let j = 0; j < 5; j++) {
      const card = new Graphics()
      card.roundRect(-9, -12, 18, 24, 2).fill(0x7f1d1d).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 })
      card.alpha = 0
      this._riffle.push(card)
    }
    c.addChild(base, label, ...this._riffle)
    return c
  }

  _animateRiffle() {
    if (!this._shuffling || this.reducedMotion) {
      for (const card of this._riffle) card.alpha = 0
      return
    }
    // CSS shoe-riffle과 같은 궤도: 슈에서 위-왼쪽 아치로 튀어나왔다 되돌아간다(카드마다 위상 스태거)
    this._riffle.forEach((card, j) => {
      const p = ((this._animT + j * 210) % 1050) / 1050
      const arc = Math.sin(Math.PI * p)
      card.position.set(-22 * arc, -20 * arc)
      card.rotation = (-16 * Math.PI) / 180 * arc
      card.alpha = p < 0.18 ? p / 0.18 : p > 0.82 ? (1 - p) / 0.18 : 1
    })
  }

  layout(w, h) {
    const compact = w < 700
    const dealerCardW = compact ? 50 : 66
    this.m = {
      w, h, compact, dealerCardW,
      dealerStep: dealerCardW + 8,
      dealerY: Math.max(104, h * 0.24),
      seatSpacing: Math.min(124, (w - 16) / SEAT_COUNT),
      seatY: h - 78,
      seatYOff: [-30, -16, -5, 0, -5, -16, -30],
      plateH: 96,
    }
    this.m.plateW = Math.min(114, this.m.seatSpacing - 6)

    this.felt.clear()
    this.felt.roundRect(6, 6, w - 12, h - 12, 24).fill(0x0d5c3f).stroke({ width: 3, color: 0xb45309, alpha: 0.35 })
    this.archText.position.set(w / 2, 34)
    this.subText.position.set(w / 2, 52)
    this.shoeLayer.position.set(w - 46, 48)
    this.dealerCards.position.set(w / 2, this.m.dealerY)
    this._recenterDealer()
    this.dealerInfo.position.set(w / 2, this.m.dealerY + dealerCardW * 0.7 + 16)
    for (let i = 0; i < SEAT_COUNT; i++) {
      const x = w / 2 + (i - (SEAT_COUNT - 1) / 2) * this.m.seatSpacing
      const y = this.m.seatY + this.m.seatYOff[i]
      this.seatCards[i].position.set(x, y - this.m.plateH / 2 - 36)
      this._relayoutSeat(i)
    }
    if (this.state) this._syncDecor(this.state)
  }

  // ── 상태 디스패치(뷰의 onState와 동일 순서) ─────────────────────────────
  onState(s) {
    if (this._destroyed || !this.m) return
    if (!this.state) {
      // 최초: 진행 중 라운드를 애니메이션 없이 스냅(가짜 딜 금지 — seedDisplay와 동일)
      this.state = s
      this._seed(s)
      this._syncDecor(s)
      return
    }
    if (s.dealer.cards.length === 0) {
      this._hardReset(s)
    } else if ((this.state.dealer.cards.length ?? 0) === 0) {
      const steps = this._freshDealSteps(s)
      s.seats.forEach((seat, i) => {
        this.planned.seats[i] = seat && seat.hands.length
          ? { handsLen: [seat.hands[0].cards.length] }
          : { handsLen: [] }
      })
      this.planned.dealerLen = s.dealer.cards.length
      this.planned.dealerFlipQueued = !s.dealer.hidden
      this._enqueue(steps)
    } else {
      this._diff(s)
    }
    // 결과 확정 순간 승리 좌석 위로 골드 파티클
    if (s.phase === 'result' && this.state.phase !== 'result') {
      s.seats.forEach((seat, i) => {
        if (!seat?.hands?.some((h) => h.result && WIN_OUTCOMES.has(h.result.outcome))) return
        const x = this.m.w / 2 + (i - (SEAT_COUNT - 1) / 2) * this.m.seatSpacing
        const y = this.m.seatY + this.m.seatYOff[i] - this.m.plateH / 2 - 30
        burst(this, { x, y, count: 26 })
      })
    }
    this.state = s
    this._syncDecor(s)
  }

  _seed(s) {
    this.revealedDealer = s.dealer.cards.map((c, i) => this._makeDealerSprite(c.code, i, { snap: true }))
    this._recenterDealer()
    this.planned.dealerLen = s.dealer.cards.length
    this.planned.dealerFlipQueued = !s.dealer.hidden
    this.revealedSeats = s.seats.map((seat, i) =>
      seat
        ? { hands: seat.hands.map((h, hi) => ({ sprites: h.cards.map((c, ci) => this._makeSeatSprite(i, hi, ci, c.code, { snap: true })) })) }
        : null
    )
    this.planned.seats = s.seats.map((seat) => ({ handsLen: seat ? seat.hands.map((h) => h.cards.length) : [] }))
    for (let i = 0; i < SEAT_COUNT; i++) this._relayoutSeat(i)
  }

  _hardReset(s) {
    this._flyAllToShoe()
    this.revealedDealer = []
    this._recenterDealer()
    this.revealedSeats = s.seats.map((seat) => (seat ? { hands: [] } : null))
    this.planned = { dealerLen: 0, dealerFlipQueued: false, seats: s.seats.map(() => ({ handsLen: [] })) }
    this.queue = []
    this.timerH?.cancel?.()
    this.timerH = null
  }

  _freshDealSteps(s) {
    const steps = []
    const act = []
    s.seats.forEach((seat, i) => {
      if (seat && seat.hands.length) act.push(i)
    })
    for (const i of act) {
      const c = s.seats[i].hands[0].cards[0]
      if (c) steps.push({ kind: 'seat', seat: i, hand: 0, card: c })
    }
    if (s.dealer.cards[0]) steps.push({ kind: 'dealer', card: s.dealer.cards[0] })
    for (const i of act) {
      const c = s.seats[i].hands[0].cards[1]
      if (c) steps.push({ kind: 'seat', seat: i, hand: 0, card: c })
    }
    if (s.dealer.cards[1]) steps.push({ kind: 'dealer', card: s.dealer.cards[1] })
    return steps
  }

  _diff(s) {
    const steps = []
    const n = Math.max(s.seats.length, this.revealedSeats.length)
    for (let i = 0; i < n; i++) {
      const serverSeat = s.seats[i]
      if (!serverSeat) {
        this._destroySeatSprites(i)
        this.revealedSeats[i] = null
        this.planned.seats[i] = { handsLen: [] }
        continue
      }
      if (!this.revealedSeats[i]) {
        this.revealedSeats[i] = { hands: [] }
        this.planned.seats[i] = { handsLen: [] }
      }
      const rSeat = this.revealedSeats[i]
      const pSeat = this.planned.seats[i] ?? (this.planned.seats[i] = { handsLen: [] })
      if (serverSeat.hands.length !== pSeat.handsLen.length) {
        if (pSeat.handsLen.length === 1 && serverSeat.hands.length === 2) {
          // 스플릿: 이미 보여준 2장을 각 핸드의 첫 장으로 즉시 재배치(애니메이션 불필요)
          const old = rSeat.hands[0]?.sprites ?? []
          rSeat.hands = [
            { sprites: old[0] ? [old[0]] : [] },
            { sprites: old[1] ? [old[1]] : [] },
          ]
          pSeat.handsLen = [old[0] ? 1 : 0, old[1] ? 1 : 0]
          this._relayoutSeat(i)
        } else {
          // 예상 밖 구조 변화 — 안전하게 즉시 스냅
          this._destroySeatSprites(i)
          rSeat.hands = serverSeat.hands.map((h, hi) => ({
            sprites: h.cards.map((c, ci) => this._makeSeatSprite(i, hi, ci, c.code, { snap: true })),
          }))
          pSeat.handsLen = serverSeat.hands.map((h) => h.cards.length)
          this._relayoutSeat(i)
          continue
        }
      }
      for (let hi = 0; hi < serverSeat.hands.length; hi++) {
        const target = serverSeat.hands[hi].cards.length
        const already = pSeat.handsLen[hi] ?? 0
        for (let ci = already; ci < target; ci++) {
          steps.push({ kind: 'seat', seat: i, hand: hi, card: serverSeat.hands[hi].cards[ci] })
        }
        pSeat.handsLen[hi] = target
      }
    }
    const td = s.dealer.cards
    if (
      this.revealedDealer.length >= 2 &&
      this.revealedDealer[1]?.code === 'BACK' &&
      td[1] && td[1].code !== 'BACK' &&
      !this.planned.dealerFlipQueued
    ) {
      steps.push({ kind: 'dealerFlip', index: 1, card: td[1] })
      this.planned.dealerFlipQueued = true
    }
    for (let ci = this.planned.dealerLen; ci < td.length; ci++) {
      steps.push({ kind: 'dealer', card: td[ci], dealerDraw: ci >= 2 })
    }
    this.planned.dealerLen = Math.max(this.planned.dealerLen, td.length)
    this._enqueue(steps)
  }

  // ── 큐 재생(뷰의 tickQueue/enqueue와 동일 타이밍: 340/480/520ms) ─────────
  _applyStep(step) {
    if (this._destroyed) return
    if (step.kind === 'seat') {
      const rs = this.revealedSeats[step.seat]
      if (!rs) return
      if (!rs.hands[step.hand]) rs.hands[step.hand] = { sprites: [] }
      const idx = rs.hands[step.hand].sprites.length
      const spr = this._makeSeatSprite(step.seat, step.hand, idx, step.card.code, { snap: this.reducedMotion })
      rs.hands[step.hand].sprites.push(spr)
      this._relayoutSeat(step.seat)
      this.sfx.cardDeal()
    } else if (step.kind === 'dealer') {
      const spr = this._makeDealerSprite(step.card.code, this.revealedDealer.length, { snap: this.reducedMotion })
      this.revealedDealer.push(spr)
      this._recenterDealer()
      this.sfx.cardDeal()
    } else if (step.kind === 'dealerFlip') {
      this.revealedDealer[step.index]?.flipTo(step.card.code)
      this.sfx.cardFlip()
    }
    if (this.state) this._syncDecor(this.state) // 카드 수 변동 → 합계/결과 표시 조건 재평가
  }

  _tick() {
    this.timerH = null
    if (!this.queue.length) return
    const step = this.queue.shift()
    this._applyStep(step)
    const d = step.kind === 'dealerFlip' ? 480 : step.dealerDraw ? 520 : 340
    this.timerH = this.delay(d, () => this._tick())
  }

  _enqueue(steps) {
    if (!steps.length) return
    if (this.reducedMotion) {
      // 모두 즉시 표시하되, 딜/플립 사운드는 그대로 발화(뷰와 동일한 비대칭)
      steps.forEach((st) => this._applyStep(st))
      return
    }
    const idle = this.queue.length === 0 && this.timerH === null
    this.queue.push(...steps)
    if (idle) this._tick()
  }

  // ── 스프라이트 생성/배치 ────────────────────────────────────────────────
  _makeDealerSprite(code, idx, { snap = false } = {}) {
    const spr = new CardSprite(this.ctx, { code, w: this.m.dealerCardW })
    this.dealerCards.addChild(spr)
    if (snap) {
      spr.position.set(idx * this.m.dealerStep, 0)
      spr.snap(code)
    } else {
      spr.dealIn({ x: idx * this.m.dealerStep, y: 0 })
    }
    return spr
  }

  _recenterDealer() {
    const n = this.revealedDealer.length
    this.dealerCards.pivot.x = n > 1 ? ((n - 1) * (this.m?.dealerStep ?? 74)) / 2 : 0
  }

  // 플레이어 핸드: 겹침은 유지하되 아래로 내려가지 않고(dy: 0) 옆으로만 쌓는다
  _seatMetrics(i) {
    const mine = this.state?.seats?.[i]?.userId === this.myUserId
    return mine ? { w: 46, reveal: 19, dy: 0 } : { w: 34, reveal: 14, dy: 0 }
  }

  _makeSeatSprite(i, hi, ci, code, { snap = false } = {}) {
    const sm = this._seatMetrics(i)
    const spr = new CardSprite(this.ctx, { code, w: sm.w })
    this.seatCards[i].addChild(spr)
    if (snap) {
      spr.position.set(ci * sm.reveal, ci * sm.dy)
      spr.snap(code)
    } else {
      spr.dealIn({ x: ci * sm.reveal, y: ci * sm.dy })
    }
    return spr
  }

  _relayoutSeat(i) {
    const rs = this.revealedSeats?.[i]
    if (!rs) return
    const sm = this._seatMetrics(i)
    const hands = Math.max(rs.hands.length, 1)
    const handW = sm.w + 26
    rs.hands.forEach((h, hi) => {
      const count = h.sprites.length
      const hx = hands > 1 ? (hi - (hands - 1) / 2) * handW : 0
      h.sprites.forEach((spr, ci) => {
        if (spr.destroyed) return
        spr.position.set(hx + ci * sm.reveal - ((count - 1) * sm.reveal) / 2, ci * sm.dy)
        spr.zIndex = ci
      })
    })
  }

  _destroySeatSprites(i) {
    const rs = this.revealedSeats?.[i]
    if (!rs) return
    rs.hands.forEach((h) => h.sprites.forEach((spr) => !spr.destroyed && spr.destroy()))
    rs.hands = []
  }

  // 라운드 리셋 시 남아 있는 모든 카드를 슈(디스카드) 방향으로 회수
  _flyAllToShoe() {
    const sprites = [
      ...this.revealedDealer,
      ...this.revealedSeats.flatMap((rs) => rs?.hands?.flatMap((h) => h.sprites) ?? []),
    ].filter((spr) => spr && !spr.destroyed)
    for (const spr of sprites) {
      if (this.reducedMotion) {
        spr.destroy()
        continue
      }
      const gp = spr.getGlobalPosition()
      const lp = this.fxLayer.toLocal(gp)
      spr.parent?.removeChild(spr)
      this.fxLayer.addChild(spr)
      spr.position.copyFrom(lp)
      const target = this.fxLayer.toLocal(this.shoeLayer.getGlobalPosition())
      const flight = this.ctx.tween({
        from: { x: lp.x, y: lp.y, sc: 1, a: 1 },
        to: { x: target.x, y: target.y, sc: 0.35, a: 0 },
        duration: 450,
        ease: toShoe,
        onUpdate: (v) => {
          if (spr.destroyed) return
          spr.position.set(v.x, v.y)
          spr.scale.set(v.sc)
          spr.alpha = v.a
        },
        onComplete: () => {
          this._flights.delete(flight)
          if (!spr.destroyed) spr.destroy()
        },
      })
      this._flights.add(flight)
    }
  }

  // ── 좌석 플레이트/텍스트(스냅샷 기반 장식 — 매 갱신 재구성) ───────────────
  _syncDecor(s) {
    if (this._destroyed) return
    this._shuffling = s.dealer.cards.length === 0 && ['betting', 'waiting'].includes(s.phase)

    this.dealerInfo.removeChildren().forEach((c) => c.destroy({ children: true }))
    const caughtUp =
      this.revealedDealer.length === s.dealer.cards.length &&
      !this.revealedDealer.some((c) => c.code === 'BACK')
    if (s.dealer.cards.length && caughtUp && s.dealer.total != null) {
      const t = new Text({ text: `딜러 ${s.dealer.total}`, style: { fill: 0xfcd34d, fontSize: 13, fontWeight: '700' } })
      t.anchor.set(0.5)
      this.dealerInfo.addChild(t)
    } else if (!s.dealer.cards.length) {
      const t = new Text({
        text: this._shuffling ? '슈에서 카드를 섞는 중…' : '대기 중',
        style: { fill: 0x34d399, fontSize: 12 },
      })
      t.anchor.set(0.5)
      this.dealerInfo.addChild(t)
    }

    this.decor.removeChildren().forEach((c) => c.destroy({ children: true }))
    this._activeHl = null
    for (let i = 0; i < SEAT_COUNT; i++) this.decor.addChild(this._buildSeatPlate(s, i))
  }

  _buildSeatPlate(s, i) {
    const { plateW, plateH, seatSpacing, seatY, seatYOff, w } = this.m
    const seat = s.seats[i]
    const c = new Container()
    c.position.set(w / 2 + (i - (SEAT_COUNT - 1) / 2) * seatSpacing, seatY + seatYOff[i])

    const mine = seat?.userId === this.myUserId
    const active = s.currentSeat === i
    const won = s.phase === 'result' && seat?.hands?.some((h) => h.result && WIN_OUTCOMES.has(h.result.outcome))

    const g = new Graphics()
    g.roundRect(-plateW / 2, -plateH / 2, plateW, plateH, 10)
      .fill({ color: 0x064e3b, alpha: seat ? 0.55 : 0.28 })
      .stroke({ width: 1.5, color: won ? 0xfbbf24 : mine ? 0xf59e0b : 0x065f46 })
    c.addChild(g)

    if (active) {
      const hl = new Graphics()
      hl.roundRect(-plateW / 2 - 2, -plateH / 2 - 2, plateW + 4, plateH + 4, 12).stroke({ width: 2, color: 0xfbbf24 })
      c.addChild(hl)
      this._activeHl = hl
    }

    if (!seat) {
      const t = new Text({ text: '+ 앉기', style: { fill: 0x34d399, fontSize: 12 } })
      t.anchor.set(0.5)
      c.addChild(t)
      onTap(g, () => this.onSit(i))
      return c
    }

    const name = new Text({
      text: seat.nickname,
      style: { fill: mine ? 0xfcd34d : 0xa7f3d0, fontSize: 11, fontWeight: '700' },
    })
    name.anchor.set(0.5, 0)
    name.position.set(0, -plateH / 2 + 5)
    c.addChild(name)

    if (seat.bet) {
      const st = chipStyleFor(seat.bet)
      const bt = new Text({ text: `${seat.bet.toLocaleString()}칩`, style: { fill: 0xd1fae5, fontSize: 10, fontWeight: '600' } })
      bt.anchor.set(0.5)
      bt.position.set(6, -12)
      const chip = new Graphics()
      chip.circle(0, 0, 6)
        .fill(parseInt(st.base.slice(1), 16))
        .stroke({ width: 1.5, color: parseInt(st.ring.slice(1), 16) })
      chip.position.set(bt.position.x - bt.width / 2 - 9, -12)
      c.addChild(chip, bt)
    }

    let ly = 6
    seat.hands.forEach((h, hi) => {
      const caught = (this.revealedSeats?.[i]?.hands?.[hi]?.sprites?.length ?? 0) === h.cards.length
      if (!caught) return
      const totalTxt = new Text({
        text: `${h.total}${h.soft ? ' (소프트)' : ''}`,
        style: { fill: 0x6ee7b7, fontSize: 10 },
      })
      totalTxt.anchor.set(0.5)
      totalTxt.position.set(0, ly)
      c.addChild(totalTxt)
      ly += 13
      if (h.result) {
        const winish = WIN_OUTCOMES.has(h.result.outcome)
        const rt = new Text({
          text: `${OUTCOME_LABELS[h.result.outcome] ?? ''}${winish ? ` +${h.result.payout.toLocaleString()}` : ''}`,
          style: {
            fill: winish ? 0xfcd34d : h.result.outcome === 'push' ? 0x6ee7b7 : 0xf87171,
            fontSize: 10,
            fontWeight: '800',
          },
        })
        rt.anchor.set(0.5)
        rt.position.set(0, ly)
        c.addChild(rt)
        ly += 13
      }
    })
    return c
  }

  destroy() {
    this._destroyed = true
    this.timerH?.cancel?.()
    this.timerH = null
    this.queue = []
    for (const f of this._flights) f.cancel?.()
    this._flights.clear()
    super.destroy()
  }
}
