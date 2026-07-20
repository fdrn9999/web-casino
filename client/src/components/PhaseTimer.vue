<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useSound } from '../composables/useSound'

const props = defineProps({
  endsAt: { type: Number, default: null },
  totalSeconds: { type: Number, default: 20 },
})
const { sfx } = useSound()

// fraction: 1 → 0 (연속). rAF로 매 프레임 갱신해 바가 뚝뚝 끊기지 않고 부드럽게 줄어든다.
const fraction = ref(0)
const secondsLeft = ref(0)
let raf = null
let lastBeep = -1
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function frame() {
  if (!props.endsAt) return
  const msLeft = Math.max(0, props.endsAt - Date.now())
  const total = props.totalSeconds * 1000
  fraction.value = total > 0 ? Math.min(1, msLeft / total) : 0
  secondsLeft.value = Math.ceil(msLeft / 1000)
  // 마지막 3초 카운트다운 비프(초마다 1회)
  if (secondsLeft.value > 0 && secondsLeft.value <= 3 && secondsLeft.value !== lastBeep) {
    lastBeep = secondsLeft.value
    sfx.countdown()
  }
  if (msLeft > 0) raf = requestAnimationFrame(frame)
  else raf = null
}

watch(
  () => props.endsAt,
  () => {
    if (raf) cancelAnimationFrame(raf)
    lastBeep = -1
    if (props.endsAt) {
      frame()
    } else {
      fraction.value = 0
      secondsLeft.value = 0
    }
  },
  { immediate: true },
)
onUnmounted(() => raf && cancelAnimationFrame(raf))
</script>

<template>
  <!-- 남은 비율에 따라 색이 emerald→amber→red로 바뀌고, 촉박할수록(≤0.25) 급박한 펄스로 베팅을 재촉한다 -->
  <div v-if="endsAt" class="w-full" :class="{ 'timer-urgent': fraction > 0 && fraction <= 0.25 && !reduced }">
    <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
      <div
        class="h-full rounded-full transition-[background-color] duration-300"
        :class="fraction > 0.5 ? 'bg-emerald-400' : fraction > 0.25 ? 'bg-amber-400' : 'bg-red-500'"
        :style="{ width: `${fraction * 100}%` }"
      />
    </div>
    <p
      class="mt-1 text-center text-sm font-bold tabular-nums transition-colors"
      :class="fraction > 0.5 ? 'text-emerald-300' : fraction > 0.25 ? 'text-amber-300' : 'text-red-400'"
    >
      <span v-if="fraction > 0.25">{{ secondsLeft }}초</span>
      <span v-else>⏰ {{ secondsLeft }}초 — 서둘러 베팅하세요!</span>
    </p>
  </div>
</template>

<style scoped>
/* 시간이 촉박해지면(≤25%) 전체 타이머가 급박하게 맥동한다 */
@keyframes timer-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.03); opacity: 0.82; }
}
.timer-urgent {
  animation: timer-pulse 0.55s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .timer-urgent { animation: none; }
}
</style>
