<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { onJackpotWon } from '../composables/useSocket'

const banner = ref(null)
let off, timer
onMounted(() => {
  off = onJackpotWon((p) => {
    banner.value = p
    clearTimeout(timer)
    timer = setTimeout(() => (banner.value = null), 8000)
  })
})
onUnmounted(() => {
  off?.()
  clearTimeout(timer)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="banner"
      class="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-5 py-2 text-sm font-bold text-emerald-950 shadow-xl">
      🎉 {{ banner.nickname }}님이 잭팟 {{ banner.amount.toLocaleString() }}칩 당첨!
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
