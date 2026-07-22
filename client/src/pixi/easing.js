// DOM(CSS) 연출과 1:1로 맞추기 위한 이징 함수들. cubic-bezier를 Newton-Raphson으로 풀어
// CSS의 cubic-bezier(...)와 동일한 곡선을 JS에서 재현한다.

export function cubicBezier(x1, y1, x2, y2) {
  // x(t), y(t) 베지어 성분. 주어진 x(진행도)에 대응하는 t를 뉴턴법으로 찾은 뒤 y를 반환.
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t) => ((ay * t + by) * t + cy) * t
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const dx = sampleX(t) - x
      const d = sampleDX(t)
      if (Math.abs(dx) < 1e-4 || d === 0) break
      t -= dx / d
    }
    return sampleY(t)
  }
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
// CSS 카드 연출과 동일한 곡선들
export const shoeTravel = cubicBezier(0.2, 0.75, 0.3, 1)
export const cardFlip = cubicBezier(0.3, 0.1, 0.2, 1)
export const overshoot = cubicBezier(0.34, 1.56, 0.64, 1)
export const wheelDecel = cubicBezier(0.15, 0.6, 0.15, 1)
export const toShoe = cubicBezier(0.4, 0, 0.8, 0.4)
