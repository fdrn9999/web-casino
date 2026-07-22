import { Container, Graphics, Text } from 'pixi.js'
import { Scene } from '../Scene'
import { CardSprite } from '../objects/CardSprite'
import { loadCardTextures, fullDeckCodes } from '../assets'
import { toShoe } from '../easing'
import { burst } from '../objects/particles'

// 바카라 Pixi 씬 — 뷰(BaccaratView)의 순차 공개 미러(revealedPlayer/Banker)를 그대로 "표시"만 한다.
// 공개 타이밍/사운드는 전부 뷰가 담당하므로 로직 복제·사운드 이중 재생이 없다.
// 씬은 카드가 늘면 슈에서 날아와 뒤집고, 리셋되면 슈로 회수하는 시각만 책임진다.
const ZONES = [
  { key: 'player', label: '플레이어', color: 0x38bdf8, border: 0x0ea5e9 },
  { key: 'banker', label: '뱅커', color: 0xf87171, border: 0xef4444 },
]
const OUTCOME_LABELS = { player: '플레이어 승!', banker: '뱅커 승!', tie: '타이!' }

export class BaccaratScene extends Scene {
  constructor(ctx) {
    super(ctx)
    this.state = null
    this.sprites = { player: [], banker: [] }
    this._flights = new Set()
    this._destroyed = false
    this._shuffling = false
  }

  async preload() {
    await loadCardTextures(fullDeckCodes())
  }

  build() {
    this.felt = new Graphics()
    this.shoeLayer = this._buildShoe()
    this.zones = {}
    for (const z of ZONES) {
      const zone = {
        box: new Graphics(),
        label: new Text({ text: z.label, style: { fill: z.color, fontSize: 13, fontWeight: '800' } }),
        total: new Text({ text: '', style: { fill: 0xfcd34d, fontSize: 16, fontWeight: '900' } }),
        cards: new Container(),
      }
      zone.label.anchor.set(0.5)
      zone.total.anchor.set(0.5)
      this.zones[z.key] = zone
    }
    this.outcome = new Text({ text: '', style: { fill: 0xfbbf24, fontSize: 20, fontWeight: '900' } })
    this.outcome.anchor.set(0.5)
    this.fxLayer = new Container()

    this.root.addChild(this.felt)
    for (const z of ZONES) {
      const zone = this.zones[z.key]
      this.root.addChild(zone.box, zone.label, zone.total, zone.cards)
    }
    this.root.addChild(this.outcome, this.fxLayer, this.shoeLayer)

    this._animT = 0
    this.ticker((t) => {
      this._animT += t.deltaMS
      this._animateRiffle()
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
    this._riffle.forEach((card, j) => {
      const p = ((this._animT + j * 210) % 1050) / 1050
      const arc = Math.sin(Math.PI * p)
      card.position.set(-22 * arc, -20 * arc)
      card.rotation = (-16 * Math.PI) / 180 * arc
      card.alpha = p < 0.18 ? p / 0.18 : p > 0.82 ? (1 - p) / 0.18 : 1
    })
  }

  layout(w, h) {
    this.m = { w, h, cardW: w < 640 ? 46 : 58 }
    this.m.cardStep = this.m.cardW + 8
    this.felt.clear()
    this.felt.roundRect(6, 6, w - 12, h - 12, 24).fill(0x0d5c3f).stroke({ width: 3, color: 0xb45309, alpha: 0.35 })
    this.shoeLayer.position.set(w - 46, 48)

    const zoneW = (w - 48) / 2
    const zoneH = h - 96
    const zoneY = 58
    ZONES.forEach((z, zi) => {
      const zone = this.zones[z.key]
      const x = 16 + zi * (zoneW + 16)
      zone._rect = { x, y: zoneY, w: zoneW, h: zoneH }
      this._drawZoneBox(z.key)
      zone.label.position.set(x + zoneW / 2, zoneY + 18)
      zone.total.position.set(x + zoneW / 2, zoneY + zoneH - 20)
      zone.cards.position.set(x + zoneW / 2, zoneY + zoneH / 2)
      this._recenter(z.key)
    })
    this.outcome.position.set(w / 2, 30)
  }

  _drawZoneBox(key) {
    const zone = this.zones[key]
    const { x, y, w, h } = zone._rect
    const winner = this.state?.phase === 'result' && this.state?.result?.outcome === key
    const meta = ZONES.find((z) => z.key === key)
    zone.box.clear()
    zone.box.roundRect(x, y, w, h, 16)
      .fill({ color: 0x022c22, alpha: 0.55 })
      .stroke({ width: winner ? 3 : 1.5, color: winner ? 0xfbbf24 : meta.border, alpha: winner ? 1 : 0.45 })
  }

  _recenter(key) {
    const n = this.sprites[key].length
    this.zones[key].cards.pivot.x = n > 1 ? ((n - 1) * this.m.cardStep) / 2 : 0
  }

  // 뷰의 공개 미러와 동기화: 늘어난 카드는 슈에서 날아와 뒤집고, 리셋(빈 배열)이면 슈로 회수.
  setCards(key, cards, { animate = true } = {}) {
    if (this._destroyed || !this.m) return
    const arr = this.sprites[key]
    if (cards.length < arr.length) {
      this._flyToShoe(arr.splice(0))
    }
    for (let i = arr.length; i < cards.length; i++) {
      const spr = new CardSprite(this.ctx, { code: cards[i].code, w: this.m.cardW })
      this.zones[key].cards.addChild(spr)
      if (animate && !this.reducedMotion) {
        // 3번째 카드는 승부를 가르는 카드 — 천천히 젖혀 까는 스퀴즈 연출
        if (i >= 2) spr.squeezeIn({ x: i * this.m.cardStep, y: 0 })
        else spr.dealIn({ x: i * this.m.cardStep, y: 0 })
      } else {
        spr.position.set(i * this.m.cardStep, 0)
        spr.snap(cards[i].code)
      }
      arr.push(spr)
    }
    this._recenter(key)
    this._syncInfo()
  }

  onState(s) {
    if (this._destroyed || !this.m) return
    const prev = this.state
    this.state = s
    this._shuffling = s.phase === 'betting'
    this._syncInfo()
    // 결과 확정 순간 승자 구역에 골드 파티클
    if (s.phase === 'result' && prev?.phase !== 'result' && s.result) {
      const winners = s.result.outcome === 'tie' ? ['player', 'banker'] : [s.result.outcome]
      for (const key of winners) {
        const r = this.zones[key]?._rect
        if (r) burst(this, { x: r.x + r.w / 2, y: r.y + r.h / 2, count: 30 })
      }
    }
  }

  _syncInfo() {
    const s = this.state
    if (!s) return
    for (const z of ZONES) {
      const zone = this.zones[z.key]
      const caughtUp = s.result && this.sprites[z.key].length === s.result[z.key].length
      zone.total.text = caughtUp ? String(z.key === 'player' ? s.result.playerTotal : s.result.bankerTotal) : ''
      this._drawZoneBox(z.key)
    }
    const showOutcome = s.phase === 'result' && s.result
    this.outcome.text = showOutcome
      ? `${OUTCOME_LABELS[s.result.outcome] ?? ''}${s.result.playerPair ? ' · P페어' : ''}${s.result.bankerPair ? ' · B페어' : ''}`
      : ''
  }

  _flyToShoe(sprites) {
    for (const spr of sprites) {
      if (!spr || spr.destroyed) continue
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

  destroy() {
    this._destroyed = true
    for (const f of this._flights) f.cancel?.()
    this._flights.clear()
    super.destroy()
  }
}
