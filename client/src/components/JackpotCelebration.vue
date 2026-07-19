<script setup>
import { ref } from 'vue'
import ConfettiBurst from './ConfettiBurst.vue'
import { useCountUp } from '../composables/useCountUp'

const open = ref(false)
const amount = ref(0)
const confetti = ref(null)
const { display } = useCountUp(() => amount.value, { durationMs: 2000 })
let timer

function celebrate(value) {
  amount.value = 0
  open.value = true
  document.documentElement.classList.add('fx-shake')
  requestAnimationFrame(() => (amount.value = value))
  confetti.value?.burst({ count: 150 })
  clearTimeout(timer)
  timer = setTimeout(close, 5000)
}

function close() {
  open.value = false
  document.documentElement.classList.remove('fx-shake')
  clearTimeout(timer)
}
defineExpose({ celebrate })
</script>

<template>
  <Teleport to="body">
    <ConfettiBurst ref="confetti" />
    <div v-if="open" class="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/80" @click="close">
      <p class="fx-pop text-5xl font-black tracking-widest text-amber-400 drop-shadow-[0_0_24px_rgba(245,158,11,0.8)]">
        💎 JACKPOT 💎</p>
      <p class="mt-4 text-4xl font-black tabular-nums text-amber-300">{{ display.toLocaleString() }} 칩</p>
      <p class="mt-6 text-xs text-emerald-400">화면을 클릭하면 닫힙니다</p>
    </div>
  </Teleport>
</template>
