<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useSound } from '../composables/useSound'

const props = defineProps({ endsAt: { type: Number, default: null }, totalSeconds: { type: Number, default: 20 } })
const { sfx } = useSound()
const remaining = ref(0)
let interval, lastBeep = -1

function tick() {
  remaining.value = props.endsAt ? Math.max(0, Math.ceil((props.endsAt - Date.now()) / 1000)) : 0
  if (remaining.value > 0 && remaining.value <= 3 && remaining.value !== lastBeep) {
    lastBeep = remaining.value
    sfx.countdown()
  }
}

watch(() => props.endsAt, () => {
  clearInterval(interval)
  lastBeep = -1
  if (props.endsAt) {
    tick()
    interval = setInterval(tick, 250)
  }
}, { immediate: true })
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <div v-if="endsAt" class="w-full">
    <div class="h-1.5 w-full overflow-hidden rounded bg-emerald-950">
      <div class="h-full bg-amber-400 transition-all"
        :style="{ width: `${Math.min(100, (remaining / totalSeconds) * 100)}%` }" />
    </div>
    <p class="mt-0.5 text-center text-xs tabular-nums text-amber-300">{{ remaining }}초</p>
  </div>
</template>
