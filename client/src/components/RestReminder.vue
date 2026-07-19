<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const hours = ref(0)
const visible = ref(false)
let interval, hideTimer

onMounted(() => {
  interval = setInterval(() => {
    hours.value += 1
    visible.value = true
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => (visible.value = false), 15000)
  }, 60 * 60 * 1000)
})
onUnmounted(() => {
  clearInterval(interval)
  clearTimeout(hideTimer)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="visible"
      class="fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/40 bg-emerald-950 px-4 py-3 text-sm text-amber-200 shadow-xl">
      <span>🕐 접속한 지 {{ hours }}시간이 지났습니다. 잠시 쉬어가는 건 어떨까요? 게임은 도망가지 않습니다.</span>
      <button class="text-emerald-400 hover:text-amber-300" @click="visible = false">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
