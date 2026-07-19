<script setup>
const props = defineProps({ code: { type: String, required: true } })

const files = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' })

const RANK_NAMES = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
}
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

function srcFor(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  if (!suit || !rank) return null
  // 실제 다운로드된 파일명은 `2` 접미 변형 없이 `{rank}_of_{suit}.svg` 형식
  return files[`../assets/cards/${rank}_of_${suit}.svg`] ?? null
}
</script>

<template>
  <div v-if="code === 'BACK'"
    class="aspect-[5/7] w-12 rounded-md border-2 border-white/80 bg-gradient-to-br from-red-800 to-red-950 shadow sm:w-16"
    aria-label="뒤집힌 카드" />
  <img v-else-if="srcFor(code)" :src="srcFor(code)" :alt="code"
    class="aspect-[5/7] w-12 rounded-md bg-white shadow sm:w-16" />
  <div v-else class="flex aspect-[5/7] w-12 items-center justify-center rounded-md bg-white text-xs font-bold text-black shadow sm:w-16">
    {{ code }}
  </div>
</template>
