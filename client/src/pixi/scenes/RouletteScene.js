import { Container, Graphics, Text } from 'pixi.js'
import { Scene } from '../Scene'
import { WHEEL_ORDER, SEG, pocketHex } from '../../lib/rouletteWheel'
import { wheelDecel, easeOutCubic } from '../easing'
import { burst } from '../objects/particles'

// 룰렛 Pixi 씬 — 휠/볼 스핀을 프레임 단위(ticker 트윈)로 렌더링한다.
// 스핀 트리거·결과는 서버 스냅샷에서 파생하며, 사운드(spinStart/spinTick)는 뷰가 담당한다.
// 각도 수학은 DOM 뷰(spinWheelTo/spinBallTo)와 동일: 결과 포켓과 볼이 항상 12시에서 만난다.
const SEG_RAD = (SEG * Math.PI) / 180

export class RouletteScene extends Scene {
  constructor(ctx) {
    super(ctx)
    this.state = null
    this.wheelRot = 0 // 휠 누적 회전(rad)
    this.ballRot = 0 // 볼 로터 누적 회전(rad)
    this._tweens = new Set()
    this._destroyed = false
  }

  build() {
    this.bg = new Graphics()
    this.wheel = new Container() // 포켓 링 + 숫자(함께 회전)
    this.ballRotor = new Container()
    this.ball = new Graphics()
    this.ball.circle(0, 0, 5).fill(0xffffff)
    this.ballRotor.addChild(this.ball)
    this.hub = new Graphics()
    this.pointer = new Text({ text: '▼', style: { fill: 0xfbbf24, fontSize: 18, fontWeight: '900' } })
    this.pointer.anchor.set(0.5, 1)
    this.badge = new Container()
    this.badgeBg = new Graphics()
    this.badgeText = new Text({ text: '', style: { fill: 0xffffff, fontSize: 26, fontWeight: '900' } })
    this.badgeText.anchor.set(0.5)
    this.badge.addChild(this.badgeBg, this.badgeText)
    this.badge.visible = false
    this.hint = new Text({ text: '베팅 후 결과를 기다리세요', style: { fill: 0x34d399, fontSize: 12 } })
    this.hint.anchor.set(0.5)
    this.root.addChild(this.bg, this.wheel, this.ballRotor, this.hub, this.pointer, this.badge, this.hint)
  }

  _buildWheel(R) {
    this.wheel.removeChildren().forEach((c) => c.destroy({ children: true }))
    const ring = new Graphics()
    WHEEL_ORDER.forEach((n, i) => {
      const center = -Math.PI / 2 + i * SEG_RAD
      ring.moveTo(0, 0)
      ring.arc(0, 0, R, center - SEG_RAD / 2, center + SEG_RAD / 2)
      ring.lineTo(0, 0)
      ring.fill(parseInt(pocketHex(n).slice(1), 16))
    })
    // 포켓 구분선 + 바깥 테두리
    WHEEL_ORDER.forEach((_, i) => {
      const a = -Math.PI / 2 + i * SEG_RAD - SEG_RAD / 2
      ring.moveTo(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4)
      ring.lineTo(Math.cos(a) * R, Math.sin(a) * R)
    })
    ring.stroke({ width: 1, color: 0x000000, alpha: 0.45 })
    ring.circle(0, 0, R).stroke({ width: 4, color: 0xf59e0b, alpha: 0.7 })
    this.wheel.addChild(ring)
    // 숫자: 포켓과 함께 회전하는 방사 배치(위쪽이 림을 향한다)
    WHEEL_ORDER.forEach((n, i) => {
      const holder = new Container()
      holder.rotation = i * SEG_RAD
      const t = new Text({ text: String(n), style: { fill: 0xffffff, fontSize: Math.max(10, R * 0.075), fontWeight: '900' } })
      t.anchor.set(0.5)
      t.position.set(0, -R * 0.86)
      holder.addChild(t)
      this.wheel.addChild(holder)
    })
  }

  layout(w, h) {
    const R = Math.min(w * 0.42, h * 0.42, 170)
    this.m = { w, h, R, trackR: R * 0.94, pocketR: R * 0.8 }
    this.bg.clear()
    this.bg.roundRect(6, 6, w - 12, h - 12, 20).fill({ color: 0x064e3b, alpha: 0.5 }).stroke({ width: 2, color: 0xf59e0b, alpha: 0.2 })
    const cx = w / 2
    const cy = h / 2 + 6
    this._buildWheel(R)
    this.wheel.position.set(cx, cy)
    this.wheel.rotation = this.wheelRot
    this.ballRotor.position.set(cx, cy)
    this.ballRotor.rotation = this.ballRot
    this.ball.position.set(0, -(this._dropped ? this.m.pocketR : this.m.trackR))
    this.hub.clear()
    this.hub.circle(cx, cy, R * 0.24).fill(0x022c22).stroke({ width: 2, color: 0xf59e0b, alpha: 0.7 })
    this.pointer.position.set(cx, cy - R - 4)
    this.badge.position.set(cx, cy)
    this.hint.position.set(cx, h - 16)
  }

  onState(s) {
    if (this._destroyed || !this.m) return
    const prev = this.state
    if (s.phase === 'spinning' && prev?.phase !== 'spinning') {
      const durationMs = (s.rules.spinSeconds - 0.5) * 1000
      this._spin(s.result, durationMs)
    }
    if (s.phase === 'result' && s.result != null) {
      this._showBadge(s.result)
      // 결과 확정 순간 배지 주변에 골드 스파클
      if (prev?.phase !== 'result') {
        burst(this, { x: this.badge.position.x, y: this.badge.position.y, count: 22, spread: 1.4 })
      }
    } else {
      this.badge.visible = false
    }
    this.hint.text = s.phase === 'betting' ? '베팅 후 결과를 기다리세요' : s.phase === 'spinning' ? '스핀!' : ''
    this.state = s
  }

  _spin(resultNumber, durationMs) {
    // 휠: 앞으로만(시계방향) 최소 5바퀴 + 결과 포켓이 12시에 오도록 (DOM spinWheelTo와 동일)
    const idx = WHEEL_ORDER.indexOf(resultNumber)
    const desiredMod = ((((360 - idx * SEG) % 360) + 360) % 360) * (Math.PI / 180)
    const currentMod = ((this.wheelRot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const delta = (((desiredMod - currentMod) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const wheelTarget = this.wheelRot + Math.PI * 10 + delta

    // 볼: 반대 방향으로 9바퀴 돌아 12시에 정착, 62% 지점에서 포켓으로 낙하.
    // 이 씬의 볼은 로터 회전 0에서 이미 12시(0, -R)에 있으므로, 로터 회전이 2π의 배수가 되도록 맞춘다
    // (DOM은 볼 기준 위치가 3시라 270° 보정을 쓰지만 여기서는 불필요).
    const ballMod = ((this.ballRot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const ballTarget = this.ballRot - ballMod - Math.PI * 18

    if (this.reducedMotion) {
      this.wheelRot = wheelTarget
      this.ballRot = ballTarget
      this.wheel.rotation = wheelTarget
      this.ballRotor.rotation = ballTarget
      this._dropped = true
      this.ball.position.set(0, -this.m.pocketR)
      return
    }

    this._dropped = false
    this.ball.position.set(0, -this.m.trackR)
    const startWheel = this.wheelRot
    const startBall = this.ballRot
    this._track(this.ctx.tween({
      from: { k: 0 },
      to: { k: 1 },
      duration: durationMs,
      ease: wheelDecel,
      onUpdate: (v) => {
        if (this._destroyed) return
        this.wheelRot = startWheel + (wheelTarget - startWheel) * v.k
        this.ballRot = startBall + (ballTarget - startBall) * v.k
        this.wheel.rotation = this.wheelRot
        this.ballRotor.rotation = this.ballRot
      },
    }))
    // 낙하: 트랙 반경 → 포켓 반경(살짝 튀며 정착)
    const dropDelay = durationMs * 0.62
    const dropWindow = Math.max(durationMs - dropDelay, 300)
    this._track(this.ctx.delay(dropDelay, () => {
      if (this._destroyed) return
      this._dropped = true
      const fromR = this.m.trackR
      const toR = this.m.pocketR
      this._track(this.ctx.tween({
        from: { k: 0 },
        to: { k: 1 },
        duration: dropWindow,
        ease: easeOutCubic,
        onUpdate: (v) => {
          if (this._destroyed) return
          const bounce = Math.sin(v.k * Math.PI * 3) * (1 - v.k) * 5
          this.ball.position.set(0, -(fromR + (toR - fromR) * v.k) + bounce)
        },
      }))
    }))
  }

  _showBadge(n) {
    this.badgeBg.clear()
    this.badgeBg.circle(0, 0, 34).fill(parseInt(pocketHex(n).slice(1), 16)).stroke({ width: 4, color: 0xfbbf24, alpha: 0.8 })
    this.badgeText.text = String(n)
    this.badge.visible = true
  }

  _track(handle) {
    this._tweens.add(handle)
    return handle
  }

  destroy() {
    this._destroyed = true
    for (const t of this._tweens) t.cancel?.()
    this._tweens.clear()
    super.destroy()
  }
}
