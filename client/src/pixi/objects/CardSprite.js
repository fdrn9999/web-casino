import { Container, Sprite, Graphics } from 'pixi.js'
import { cardTexture } from '../assets'
import { shoeTravel, cardFlip } from '../easing'

const RATIO = 7 / 5 // 5:7 카드 박스

// 카드 한 장 — 앞면 스프라이트(SVG 텍스처) 또는 뒷면(Graphics). 슈에서 날아오는 딜 연출과
// scaleX 0→1 뒤집기로 CSS의 rotateY 플립을 2D로 재현한다. CardImg.vue의 타이밍을 그대로 따른다.
export class CardSprite extends Container {
  constructor(ctx, { code, w = 64 }) {
    super()
    this.ctx = ctx
    this._w = w
    this._h = w * RATIO
    this._code = code
    this.face = new Container()
    this.addChild(this.face)
    this._render(code)
    this._reveal = null
    this._flipT = null
    this._delayH = null
  }

  get code() {
    return this._code
  }

  _render(code) {
    this.face.removeChildren().forEach((c) => c.destroy())
    if (code === 'BACK') {
      this.face.addChild(this._backGraphic())
    } else {
      const tex = cardTexture(code)
      if (tex) {
        const spr = new Sprite(tex)
        spr.anchor.set(0.5)
        spr.width = this._w
        spr.height = this._h
        this.face.addChild(spr)
      } else {
        this.face.addChild(this._placeholder(code))
      }
    }
  }

  _backGraphic() {
    const g = new Graphics()
    const w = this._w
    const h = this._h
    g.roundRect(-w / 2, -h / 2, w, h, 4).fill(0x7f1d1d).stroke({ width: 2, color: 0xffffff, alpha: 0.8 })
    // 대각 해치 무늬
    for (let i = -h; i < w; i += 8) {
      g.moveTo(-w / 2 + i, -h / 2).lineTo(-w / 2 + i + h, h / 2)
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.06 })
    return g
  }

  _placeholder(code) {
    const g = new Graphics()
    const w = this._w
    const h = this._h
    g.roundRect(-w / 2, -h / 2, w, h, 4).fill(0xffffff).stroke({ width: 1, color: 0x000000, alpha: 0.4 })
    return g
  }

  snap(code) {
    this._code = code
    this._render(code)
    this.face.scale.x = 1
    this.face.alpha = 1
    this.face.position.set(0, 0)
    this.face.rotation = 0
  }

  // 슈(우상단)에서 날아와 260ms 뒤 스스로 앞면으로 뒤집는다. reduced-motion이면 즉시 앞면.
  dealIn({ x = 0, y = 0 } = {}) {
    this.position.set(x, y)
    if (this.ctx.reducedMotion) {
      this._render(this._code)
      return
    }
    const known = this._code
    this._render('BACK')
    this.face.alpha = 0
    this._reveal = this.ctx.tween({
      from: { dx: 58, dy: -46, sc: 0.55, rot: (12 * Math.PI) / 180, a: 0 },
      to: { dx: 0, dy: 0, sc: 1, rot: 0, a: 1 },
      duration: 300,
      ease: shoeTravel,
      onUpdate: (v) => {
        this.face.position.set(v.dx, v.dy)
        this.face.scale.set(v.sc)
        this.face.rotation = v.rot
        this.face.alpha = v.a
      },
    })
    if (known !== 'BACK') {
      this._delayH = this.ctx.delay(260, () => this.flipTo(known))
    }
  }

  // 스퀴즈(쪼으기): 뒷면으로 도착한 카드를 아래에서 천천히 젖혀 까는 서스펜스 연출.
  // 바카라 3번째 카드처럼 승부를 가르는 카드에 쓴다. 세로(scaleY) 젖힘 + 살짝 기울임.
  squeezeIn({ x = 0, y = 0 } = {}) {
    this.position.set(x, y)
    if (this.ctx.reducedMotion) {
      this._render(this._code)
      return
    }
    const known = this._code
    this._render('BACK')
    this.face.alpha = 0
    this._reveal = this.ctx.tween({
      from: { dx: 58, dy: -46, sc: 0.55, rot: (12 * Math.PI) / 180, a: 0 },
      to: { dx: 0, dy: 0, sc: 1, rot: 0, a: 1 },
      duration: 300,
      ease: shoeTravel,
      onUpdate: (v) => {
        this.face.position.set(v.dx, v.dy)
        this.face.scale.set(v.sc)
        this.face.rotation = v.rot
        this.face.alpha = v.a
      },
    })
    if (known !== 'BACK') {
      this._delayH = this.ctx.delay(320, () => this._peelTo(known))
    }
  }

  _peelTo(code) {
    this._flipT?.cancel?.()
    let swapped = false
    this._flipT = this.ctx.tween({
      from: { k: 0 },
      to: { k: 1 },
      duration: 900,
      ease: cardFlip,
      onUpdate: (v) => {
        const k = v.k
        if (k >= 0.55 && !swapped) {
          swapped = true
          this._code = code
          this._render(code)
        }
        // 0~0.55: 천천히 젖힌다(뒷면이 접힘) / 0.55~1: 앞면이 펼쳐진다
        const sy = k < 0.55 ? 1 - (k / 0.55) * 0.88 : 0.12 + ((k - 0.55) / 0.45) * 0.88
        this.face.scale.y = sy
        this.face.rotation = Math.sin(k * Math.PI) * 0.07
      },
      onComplete: () => {
        this._code = code
        this.face.scale.y = 1
        this.face.rotation = 0
      },
    })
  }

  // BACK→실카드 뒤집기(0.42s). scaleX를 1→0→1로 줄였다 늘리며 중간에 텍스처를 교체.
  flipTo(code) {
    if (this.ctx.reducedMotion) {
      this.snap(code)
      return
    }
    this._flipT?.cancel?.()
    let swapped = false
    this._flipT = this.ctx.tween({
      from: { k: 0 },
      to: { k: 1 },
      duration: 420,
      ease: cardFlip,
      onUpdate: (v) => {
        if (v.k >= 0.5 && !swapped) {
          swapped = true
          this._code = code
          this._render(code)
        }
        this.face.scale.x = Math.abs(1 - 2 * v.k)
      },
      onComplete: () => {
        this._code = code
        this.face.scale.x = 1
      },
    })
  }

  destroy(opts) {
    this._reveal?.cancel?.()
    this._flipT?.cancel?.()
    this._delayH?.cancel?.()
    super.destroy(opts ?? { children: true })
  }
}
