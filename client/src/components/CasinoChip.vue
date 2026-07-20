<script setup>
import { computed } from 'vue'
import { chipStyleFor, formatChipLabel } from '../lib/chips'

const props = defineProps({
  value: { type: Number, required: true },
  size: { type: Number, default: 56 },
  selected: { type: Boolean, default: false },
})

const style = computed(() => chipStyleFor(props.value))
const label = computed(() => formatChipLabel(props.value))
// 가장자리 대시(카지노 칩 특유의 테두리 눈금) 각도 배열
const EDGE_ANGLES = Array.from({ length: 12 }, (_, i) => i * 30)
</script>

<template>
  <div
    class="casino-chip inline-block select-none"
    :class="{ 'casino-chip--selected': selected }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-label="`${value.toLocaleString()}칩`"
    role="img"
  >
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <!-- 바깥 테두리 -->
      <circle cx="50" cy="50" r="48" :fill="style.edge" />
      <!-- 가장자리 눈금(대시) -->
      <g v-for="a in EDGE_ANGLES" :key="a" :transform="`rotate(${a} 50 50)`">
        <rect x="46.5" y="2.5" width="7" height="13" rx="1.4" :fill="style.base" opacity="0.92" />
      </g>
      <!-- 본체 -->
      <circle cx="50" cy="50" r="39" :fill="style.base" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" />
      <!-- 안쪽 점선 링 -->
      <circle cx="50" cy="50" r="33" fill="none" :stroke="style.ring" stroke-width="2.2" stroke-dasharray="3.2 4.4" opacity="0.85" />
      <!-- 중앙 원 + 값 -->
      <circle cx="50" cy="50" r="25" :fill="style.edge" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" />
      <text x="50" y="55" text-anchor="middle" :fill="style.text" font-size="19" font-weight="900" font-family="Pretendard, 'Malgun Gothic', sans-serif">{{ label }}</text>
    </svg>
  </div>
</template>

<style scoped>
.casino-chip {
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
  transition: transform 0.15s ease, filter 0.15s ease;
}
.casino-chip--selected {
  filter: drop-shadow(0 4px 6px rgba(251, 191, 36, 0.55)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
}
</style>
