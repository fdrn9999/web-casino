import { ref, watch, onUnmounted } from 'vue'

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useCountUp(getTarget, { durationMs = 600 } = {}) {
  const display = ref(getTarget() ?? 0)
  let raf = null

  watch(getTarget, (target) => {
    if (target == null) return
    if (reduced) {
      display.value = target
      return
    }
    cancelAnimationFrame(raf)
    const from = display.value
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      display.value = Math.round(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })

  onUnmounted(() => {
    cancelAnimationFrame(raf)
  })

  return { display }
}
