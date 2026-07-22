import { Container } from 'pixi.js'

// 모든 게임 씬의 추상 베이스. root 컨테이너와 ticker 정리를 담당한다.
// 하위 클래스는 build/layout/onState/destroy를 오버라이드한다.
export class Scene {
  constructor(ctx) {
    this.ctx = ctx
    this.app = ctx.app
    this.reducedMotion = ctx.reducedMotion
    this.tween = ctx.tween
    this.delay = ctx.delay
    this.sfx = ctx.sfx
    this.root = new Container()
    this._tickers = new Set()
  }

  build() {}
  layout(_w, _h) {}
  onState(_s) {}

  ticker(fn) {
    this._tickers.add(fn)
    this.app.ticker.add(fn)
    return fn
  }

  destroy() {
    for (const fn of this._tickers) this.app.ticker.remove(fn)
    this._tickers.clear()
    this.root.destroy({ children: true })
  }
}
