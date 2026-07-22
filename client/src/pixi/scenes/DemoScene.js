import { Container, Graphics, Text } from 'pixi.js'
import { Scene } from '../Scene'
import { CardSprite } from '../objects/CardSprite'
import { loadCardTextures } from '../assets'
import { CHIP_STYLES } from '../../lib/chips'

// Phase A 검증용 데모 씬 — 펠트/슈/카드 딜(슈에서 날아와 플립)/칩 스택을 렌더해
// PixiStage + CardSprite + tween + SVG 텍스처 파이프라인이 실제로 동작함을 눈으로 확인한다.
// 서버/소켓과 무관한 순수 표현 데모.
const DEMO_DEALER = ['AS', '10H'] // 딜러 나란히
const DEMO_PLAYER = ['KD', '9C', '2S'] // 플레이어 캐스케이드

export class DemoScene extends Scene {
  async preload() {
    await loadCardTextures([...DEMO_DEALER, ...DEMO_PLAYER])
  }

  build() {
    this.felt = new Graphics()
    this.arcText = new Text({
      text: 'BLACKJACK PAYS 3:2',
      style: { fill: 0xf59e0b, fontSize: 18, fontWeight: '800', letterSpacing: 2 },
    })
    this.arcText.anchor.set(0.5)
    this.shoe = this._shoe()
    this.dealerLayer = new Container()
    this.playerLayer = new Container()
    this.chipLayer = this._chipStack(1600)
    this.hint = new Text({
      text: 'PixiJS 렌더 데모 — 실제 카드 SVG · 슈 딜 · 플립 · 칩 스택',
      style: { fill: 0x6ee7b7, fontSize: 13 },
    })
    this.hint.anchor.set(0.5)

    this.root.addChild(this.felt, this.arcText, this.shoe, this.dealerLayer, this.playerLayer, this.chipLayer, this.hint)
    this._dealDemo()
    // 4초마다 다시 딜해 애니메이션을 반복 확인
    this._loop = this.ticker((t) => {
      this._elapsed = (this._elapsed || 0) + t.deltaMS
      if (this._elapsed > 4200) {
        this._elapsed = 0
        this._dealDemo()
      }
    })
  }

  _shoe() {
    const g = new Graphics()
    g.roundRect(-13, -17, 26, 34, 3).fill(0x7f1d1d).stroke({ width: 2, color: 0xffffff, alpha: 0.75 })
    return g
  }

  _chipStack(amount) {
    // 액면 그리디 분해 후, 큰 액면이 아래로 쌓이는 칩 더미(두께감).
    const c = new Container()
    const values = [50000, 10000, 5000, 1000, 500, 100]
    let remaining = amount
    const chips = []
    for (const v of values) while (remaining >= v && chips.length < 6) { chips.push(v); remaining -= v }
    chips.reverse().forEach((v, i) => {
      const st = CHIP_STYLES[v]
      const chip = new Graphics()
      const y = -i * 6
      chip.circle(0, y, 18).fill(parseInt(st.edge.slice(1), 16)) // 옆면(두께)
      chip.circle(0, y - 3, 18).fill(parseInt(st.base.slice(1), 16)).stroke({ width: 2, color: parseInt(st.ring.slice(1), 16) })
      c.addChild(chip)
    })
    const label = new Text({ text: amount.toLocaleString(), style: { fill: 0xfde68a, fontSize: 12, fontWeight: '700' } })
    label.anchor.set(0.5)
    label.y = -chips.length * 6 - 26
    c.addChild(label)
    return c
  }

  _dealDemo() {
    this.dealerLayer.removeChildren().forEach((c) => c.destroy())
    this.playerLayer.removeChildren().forEach((c) => c.destroy())
    // 딜러: 나란히
    DEMO_DEALER.forEach((code, i) => {
      const card = new CardSprite(this.ctx, { code: i === 1 && !this._flipHole ? 'BACK' : code, w: 72 })
      this.dealerLayer.addChild(card)
      card.dealIn({ x: i * 84, y: 0 })
    })
    // 플레이어: 옆으로 겹침 — 3번째 카드는 스퀴즈(천천히 젖혀 까기) 연출 데모
    DEMO_PLAYER.forEach((code, i) => {
      const card = new CardSprite(this.ctx, { code, w: 60 })
      this.playerLayer.addChild(card)
      if (i === 2) card.squeezeIn({ x: i * 22, y: 0 })
      else card.dealIn({ x: i * 22, y: 0 })
    })
    this.layout(this.app.screen.width, this.app.screen.height)
  }

  layout(w, h) {
    const cx = w / 2
    this.felt.clear()
    this.felt.roundRect(16, 16, w - 32, h - 32, 28).fill(0x0d5c3f).stroke({ width: 4, color: 0xb45309, alpha: 0.4 })
    this.arcText.position.set(cx, 60)
    this.shoe.position.set(w - 60, 60)
    this.dealerLayer.position.set(cx - 42, 110)
    this.playerLayer.position.set(cx - 30, h - 220)
    this.chipLayer.position.set(cx, h - 90)
    this.hint.position.set(cx, h - 40)
  }
}
