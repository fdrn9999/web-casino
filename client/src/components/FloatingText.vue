<script setup>
import { ref } from 'vue'

const items = ref([])
let seq = 0

function show(text, variant = 'win') {
  const id = ++seq
  items.value.push({ id, text, variant })
  if (items.value.length > 5) items.value.shift()
  setTimeout(() => {
    items.value = items.value.filter((i) => i.id !== id)
  }, 1200)
}
defineExpose({ show })
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-1/3 z-40 flex flex-col items-center gap-1">
    <TransitionGroup name="float">
      <span v-for="i in items" :key="i.id"
        class="float-item text-2xl font-black drop-shadow-lg"
        :class="i.variant === 'win' ? 'text-amber-300' : 'text-red-400'">
        {{ i.text }}
      </span>
    </TransitionGroup>
  </div>
</template>

<style scoped>
@keyframes float-up {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-56px); opacity: 0; }
}
.float-item { animation: float-up 1.2s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .float-item { animation: none; opacity: 0; }
}
</style>
