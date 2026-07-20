<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  code: { type: String, required: true },
  animate: { type: Boolean, default: true },
})

const files = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' })

const RANK_NAMES = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
}
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

function srcFor(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  return (
    files[`../assets/cards/${rank}_of_${suit}2.svg`] ??
    files[`../assets/cards/${rank}_of_${suit}.svg`] ??
    null
  )
}

const src = computed(() => srcFor(props.code))

const flipping = ref(false)
watch(() => props.code, (next, prev) => {
  if (prev === 'BACK' && next !== 'BACK') {
    flipping.value = false
    requestAnimationFrame(() => (flipping.value = true))
  }
})
</script>

<template>
  <div v-if="code === 'BACK'"
    :class="[animate ? 'fx-deal-in' : '', flipping ? 'fx-flip' : '']"
    class="aspect-[5/7] w-12 rounded-md border-2 border-white/80 bg-gradient-to-br from-red-800 to-red-950 shadow sm:w-16"
    aria-label="뒤집힌 카드" />
  <img v-else-if="src" :src="src" :alt="code"
    :class="[animate ? 'fx-deal-in' : '', flipping ? 'fx-flip' : '']"
    class="aspect-[5/7] w-12 rounded-md bg-white shadow sm:w-16" />
  <div v-else
    :class="[animate ? 'fx-deal-in' : '', flipping ? 'fx-flip' : '']"
    class="flex aspect-[5/7] w-12 items-center justify-center rounded-md bg-white text-xs font-bold text-black shadow sm:w-16">
    {{ code }}
  </div>
</template>
