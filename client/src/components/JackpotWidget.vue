<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { onJackpotPool } from '../composables/useSocket'

const pool = ref(0)
let off
onMounted(async () => {
  pool.value = (await api('/slots/state')).pool
  off = onJackpotPool(({ pool: p }) => (pool.value = p))
})
onUnmounted(() => off?.())
</script>

<template>
  <section class="rounded-xl border border-amber-500/40 bg-gradient-to-r from-emerald-900 to-emerald-950 p-4 text-center">
    <p class="text-xs text-amber-300">💎 프로그레시브 잭팟</p>
    <p class="mt-1 text-3xl font-black tabular-nums text-amber-400">{{ pool.toLocaleString() }} 칩</p>
    <p class="mt-1 text-xs text-emerald-400">슬롯 스핀마다 쌓입니다. 7-7-7이면 전액 당첨!</p>
  </section>
</template>
