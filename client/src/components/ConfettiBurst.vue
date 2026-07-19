<script setup>
import { ref, onUnmounted } from 'vue'

const canvas = ref(null)
const active = ref(false)
let raf = null

const COLORS = ['#f59e0b', '#fbbf24', '#fde68a', '#34d399', '#ffffff']
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function burst({ count = 120, durationMs = 2500 } = {}) {
  if (reduced) return
  active.value = true
  requestAnimationFrame(() => {
    const el = canvas.value
    el.width = window.innerWidth
    el.height = window.innerHeight
    const ctx = el.getContext('2d')
    const parts = Array.from({ length: Math.min(count, 150) }, () => ({
      x: el.width / 2 + (Math.random() - 0.5) * el.width * 0.4,
      y: el.height * 0.3,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 10 - 4,
      size: Math.random() * 8 + 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }))
    const start = performance.now()
    const tick = (now) => {
      const t = now - start
      ctx.clearRect(0, 0, el.width, el.height)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.35
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0, 1 - t / durationMs)
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (t < durationMs) raf = requestAnimationFrame(tick)
      else {
        ctx.clearRect(0, 0, el.width, el.height)
        active.value = false
      }
    }
    raf = requestAnimationFrame(tick)
  })
}

onUnmounted(() => cancelAnimationFrame(raf))
defineExpose({ burst })
</script>

<template>
  <canvas v-show="active" ref="canvas" class="pointer-events-none fixed inset-0 z-50" />
</template>
