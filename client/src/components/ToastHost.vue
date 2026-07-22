<script setup>
import { useToast } from '../composables/useToast'

const { toasts, dismissToast } = useToast()

const STYLE = {
  info: 'bg-emerald-800/95 text-emerald-50 border-emerald-400/40',
  success: 'bg-emerald-600/95 text-white border-emerald-300/50',
  error: 'bg-red-600/95 text-white border-red-300/50',
}
const ICON = { info: 'ℹ️', success: '✅', error: '⚠️' }
</script>

<template>
  <div class="pointer-events-none fixed left-1/2 top-16 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-3"
    aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id"
        class="pointer-events-auto flex w-full cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl backdrop-blur"
        :class="STYLE[t.type] || STYLE.info" role="status" @click="dismissToast(t.id)">
        <span class="text-base">{{ ICON[t.type] || ICON.info }}</span>
        <span class="flex-1 leading-snug">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-12px); }
/* 사라지는 토스트를 흐름에서 빼 남은 토스트가 부드럽게 위로 당겨지도록 */
.toast-leave-active { position: absolute; width: calc(100% - 1.5rem); }
</style>
