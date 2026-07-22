import { Container, Graphics } from 'pixi.js'

// 승리 파티클 — 금빛 조각들이 위로 터졌다가 중력으로 떨어지며 사라지는 버스트.
// 씬의 ticker 부기(scene._tickers)를 재사용해 씬 파괴 시 함께 정리된다.
const GOLD = [0xfbbf24, 0xfde68a, 0xf59e0b, 0xffffff]

export function burst(scene, { x, y, count = 26, colors = GOLD, spread = 1 } = {}) {
  if (scene.reducedMotion || scene._destroyed) return
  const layer = new Container()
  scene.root.addChild(layer)
  const parts = []
  for (let i = 0; i < count; i++) {
    const g = new Graphics()
    const size = 3 + Math.random() * 4
    const color = colors[Math.floor(Math.random() * colors.length)]
    if (Math.random() < 0.5) g.rect(-size / 2, -size / 2, size, size * 0.65).fill(color)
    else g.circle(0, 0, size / 2).fill(color)
    g.position.set(x, y)
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9 * spread
    const speed = 0.12 + Math.random() * 0.22
    parts.push({
      g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vr: (Math.random() - 0.5) * 0.012,
    })
    layer.addChild(g)
  }
  const LIFE = 1100
  let t = 0
  const fn = (ticker) => {
    const dt = ticker.deltaMS
    t += dt
    for (const p of parts) {
      p.vy += 0.00045 * dt // 중력
      p.g.x += p.vx * dt
      p.g.y += p.vy * dt
      p.g.rotation += p.vr * dt
      p.g.alpha = Math.max(0, 1 - t / LIFE)
    }
    if (t >= LIFE) {
      scene.app.ticker.remove(fn)
      scene._tickers.delete(fn)
      layer.destroy({ children: true })
    }
  }
  scene._tickers.add(fn)
  scene.app.ticker.add(fn)
}
