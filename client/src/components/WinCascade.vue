<script setup>
import { ref } from 'vue'
import CasinoChip from './CasinoChip.vue'
import { CHIP_VALUES } from '../lib/chips'
import { sfx } from '../composables/useSound'

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const items = ref([])
let seq = 0
let clearTimer = null

/** 승리 시 테이블에서 헤더의 잔액 표시 쪽으로 칩이 촤라락 날아가는 연출. */
function burst({ count = 16 } = {}) {
  if (reduced) return
  sfx.chipWin()
  const batch = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 110 + Math.random() * 260
    return {
      id: ++seq,
      sx: Math.cos(angle) * dist,
      sy: Math.abs(Math.sin(angle)) * dist * 0.55 + 70,
      delay: Math.random() * 0.35,
      dur: 0.85 + Math.random() * 0.5,
      value: CHIP_VALUES[Math.floor(Math.random() * CHIP_VALUES.length)],
      size: 20 + Math.random() * 14,
    }
  })
  items.value.push(...batch)
  clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    items.value = []
  }, 1700)
}

defineExpose({ burst })
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <div
        v-for="it in items" :key="it.id" class="cascade-chip"
        :style="{
          '--sx': `${it.sx}px`, '--sy': `${it.sy}px`,
          animationDelay: `${it.delay}s`, animationDuration: `${it.dur}s`,
        }"
      >
        <CasinoChip :value="it.value" :size="it.size" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cascade-chip {
  position: fixed;
  top: 18px;
  right: 96px;
  transform: translate(var(--sx), var(--sy)) scale(1);
  opacity: 0;
  animation-name: chip-cascade;
  animation-timing-function: cubic-bezier(0.2, 0.6, 0.15, 1);
  animation-fill-mode: both;
}
@keyframes chip-cascade {
  0% { transform: translate(var(--sx), var(--sy)) scale(1) rotate(0deg); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translate(0, 0) scale(0.3) rotate(280deg); opacity: 0; }
}
</style>
