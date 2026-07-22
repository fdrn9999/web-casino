// PixiJS용 초경량 트윈/딜레이 헬퍼 — GSAP 없이 app.ticker(deltaMS) 기반으로 값을 보간한다.
// 모든 타이밍이 ticker에 묶여 있어 app.destroy() 시 함께 정리된다(orphan setTimeout 없음 → 누수 방지).

// makeTween(app, { from, to, duration, ease, onUpdate, onComplete }) → { cancel() }
// duration<=0(감소 모션/시드 경로)이면 즉시 to로 점프한다.
export function makeTween(app, { from, to, duration, ease = (t) => t, onUpdate, onComplete }) {
  if (duration <= 0) {
    onUpdate?.(to, 1)
    onComplete?.()
    return { cancel() {} }
  }
  const keys = Object.keys(from)
  let t = 0
  let done = false
  const fn = (ticker) => {
    t += ticker.deltaMS
    const k = Math.min(t / duration, 1)
    const e = ease(k)
    const v = {}
    for (const key of keys) v[key] = from[key] + (to[key] - from[key]) * e
    onUpdate?.(v, k)
    if (k >= 1 && !done) {
      done = true
      app.ticker.remove(fn)
      onComplete?.()
    }
  }
  app.ticker.add(fn)
  return {
    cancel() {
      if (!done) {
        done = true
        app.ticker.remove(fn)
      }
    },
  }
}

// makeDelay(app, ms, fn) → { cancel() } — ticker 기반 setTimeout 대체(파괴 시 함께 정리).
export function makeDelay(app, ms, fn) {
  if (ms <= 0) {
    fn()
    return { cancel() {} }
  }
  let t = 0
  let done = false
  const step = (ticker) => {
    t += ticker.deltaMS
    if (t >= ms && !done) {
      done = true
      app.ticker.remove(step)
      fn()
    }
  }
  app.ticker.add(step)
  return {
    cancel() {
      if (!done) {
        done = true
        app.ticker.remove(step)
      }
    },
  }
}
