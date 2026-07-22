import { Container, Graphics, Text, BlurFilter } from 'pixi.js'
import { Scene } from '../Scene'
import { burst } from '../objects/particles'

// 슬롯 Pixi 씬 — 뷰(SlotsView)의 릴 상태(reelStrips/reelY/reelState/suspense)를 매 프레임 미러링한다.
// 스핀 물리·정지 트윈·사운드는 전부 뷰의 기존 로직이 담당하고, 씬은 그리기만 한다.
const ITEM_H = 96
const REEL_W = 88
const GAP = 14

export class SlotsScene extends Scene {
  constructor(ctx, { getFrame }) {
    super(ctx)
    this.getFrame = getFrame
    this._destroyed = false
    this._cache = [
      { ref: null, len: 0 },
      { ref: null, len: 0 },
      { ref: null, len: 0 },
    ]
  }

  build() {
    this.bg = new Graphics()
    this.root.addChild(this.bg)
    this.reels = []
    for (let i = 0; i < 3; i++) {
      const holder = new Container()
      const frame = new Graphics()
      frame.roundRect(0, 0, REEL_W, ITEM_H, 12).fill(0x022c22)
      const col = new Container()
      const mask = new Graphics()
      mask.roundRect(0, 0, REEL_W, ITEM_H, 12).fill(0xffffff)
      col.mask = mask
      const ring = new Graphics()
      const shade = new Graphics()
      shade.rect(0, 0, REEL_W, 20).fill({ color: 0x000000, alpha: 0.35 })
      shade.rect(0, ITEM_H - 20, REEL_W, 20).fill({ color: 0x000000, alpha: 0.35 })
      shade.mask = null
      holder.addChild(frame, col, mask, shade, ring)
      this.root.addChild(holder)
      // 스핀 중 세로 모션 블러(감소 모션 시 비활성). blurX/blurY 미지원 빌드면 strength로 폴백.
      const blur = new BlurFilter({ strength: 0, quality: 3 })
      try {
        blur.blurX = 0
      } catch {
        // 세로 전용 설정 불가 시 전체 블러로 대체
      }
      this.reels.push({ holder, col, ring, texts: [], blur, blurAmt: -1 })
    }
    this._animT = 0
    this.ticker((t) => {
      this._animT += t.deltaMS
      this._sync()
    })
  }

  layout(w, h) {
    this.m = { w, h }
    const totalW = REEL_W * 3 + GAP * 2
    const x0 = (w - totalW) / 2
    const y0 = (h - ITEM_H) / 2
    this.bg.clear()
    this.bg.roundRect(6, 6, w - 12, h - 12, 18).fill({ color: 0x064e3b, alpha: 0.35 })
    this.reels.forEach((r, i) => {
      r.holder.position.set(x0 + i * (REEL_W + GAP), y0)
    })
  }

  _rebuildStrip(i, strip) {
    const r = this.reels[i]
    r.texts.forEach((t) => t.destroy())
    r.texts = strip.map((sym, j) => {
      const t = new Text({ text: sym, style: { fontSize: 52 } })
      t.anchor.set(0.5)
      t.position.set(REEL_W / 2, j * ITEM_H + ITEM_H / 2)
      r.col.addChild(t)
      return t
    })
  }

  _appendStrip(i, strip, fromLen) {
    const r = this.reels[i]
    for (let j = fromLen; j < strip.length; j++) {
      const t = new Text({ text: strip[j], style: { fontSize: 52 } })
      t.anchor.set(0.5)
      t.position.set(REEL_W / 2, j * ITEM_H + ITEM_H / 2)
      r.col.addChild(t)
      r.texts.push(t)
    }
  }

  _sync() {
    if (this._destroyed) return
    const f = this.getFrame?.()
    if (!f) return
    for (let i = 0; i < 3; i++) {
      const strip = f.strips[i] ?? []
      const cache = this._cache[i]
      if (cache.ref !== strip) {
        this._rebuildStrip(i, strip)
        cache.ref = strip
        cache.len = strip.length
      } else if (cache.len !== strip.length) {
        // 뷰가 스핀 중 꼬리에 심볼을 추가(push)한 경우 — 새 심볼만 덧붙인다
        this._appendStrip(i, strip, cache.len)
        cache.len = strip.length
      }
      const r = this.reels[i]
      r.col.y = f.y[i] ?? 0
      // 스핀/서스펜스 링: 크기 불변, 색/알파만 바뀐다
      const spinning = f.states[i] === 'spinning' || f.states[i] === 'stopping'
      const susp = f.suspense && i === 2
      // 세로 모션 블러: 회전 중 강하게, 감속 중 약하게, 정지 시 제거(상태 바뀔 때만 갱신)
      const blurAmt = this.reducedMotion ? 0 : f.states[i] === 'spinning' ? 7 : f.states[i] === 'stopping' ? 3 : 0
      if (blurAmt !== r.blurAmt) {
        r.blurAmt = blurAmt
        try {
          r.blur.blurY = blurAmt
        } catch {
          r.blur.strength = blurAmt
        }
        r.col.filters = blurAmt > 0 ? [r.blur] : []
      }
      r.ring.clear()
      if (susp) {
        const a = 0.6 + 0.4 * Math.sin(this._animT / 140)
        r.ring.roundRect(-2, -2, REEL_W + 4, ITEM_H + 4, 13).stroke({ width: 3, color: 0xf87171, alpha: a })
      } else if (spinning) {
        r.ring.roundRect(-1.5, -1.5, REEL_W + 3, ITEM_H + 3, 13).stroke({ width: 2, color: 0xfbbf24, alpha: 0.7 })
      } else if (f.glow) {
        const a = 0.5 + 0.4 * Math.sin(this._animT / 200)
        r.ring.roundRect(-2, -2, REEL_W + 4, ITEM_H + 4, 13).stroke({ width: 3, color: 0xfbbf24, alpha: a })
      }
    }
    // 당첨 순간(글로우 상승 에지) 릴 위로 골드 파티클
    if (f.glow && !this._prevGlow && this.m) {
      burst(this, { x: this.m.w / 2, y: this.m.h / 2, count: 30, spread: 1.3 })
    }
    this._prevGlow = f.glow
  }

  destroy() {
    this._destroyed = true
    super.destroy()
  }
}
