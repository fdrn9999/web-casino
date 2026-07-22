<script setup>
import { computed } from 'vue'
import { chipStyleFor, formatChipLabel } from '../lib/chips'

const props = defineProps({
  value: { type: Number, required: true },
  size: { type: Number, default: 56 },
  selected: { type: Boolean, default: false },
  // 더미(스택) 속 칩: 옆면 두께(하드 섀도 압출)를 그려 실제 칩이 쌓인 듯한 입체감을 준다.
  stacked: { type: Boolean, default: false },
})

const style = computed(() => chipStyleFor(props.value))
const label = computed(() => formatChipLabel(props.value))
// 가장자리 대시(카지노 칩 특유의 테두리 눈금) 각도 배열
const EDGE_ANGLES = Array.from({ length: 12 }, (_, i) => i * 30)

// 칩 옆면(두께) 색 — 엣지 색을 어둡게 내려 실린더 옆면처럼 보이게 한다.
function shade(hex, f = 0.55) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `rgb(${r} ${g} ${b})`
}
const sideColor = computed(() => shade(style.value.edge))
const sideTh = computed(() => Math.max(2, Math.round(props.size * 0.12)))
</script>

<template>
  <div
    class="casino-chip inline-block select-none"
    :class="{ 'casino-chip--selected': selected, 'casino-chip--stacked': stacked }"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      '--side-color': sideColor,
      '--side-th': `${sideTh}px`,
    }"
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
      <!-- 중앙 원 + 값 — 작은 크기에서도 액면이 읽히도록 중앙 원과 글자를 크게 -->
      <circle cx="50" cy="50" r="27" :fill="style.edge" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" />
      <text x="50" y="57" text-anchor="middle" :fill="style.text" font-size="23" font-weight="900" font-family="Pretendard, 'Malgun Gothic', sans-serif">{{ label }}</text>
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
/* 스택용: 블러 없는 하드 섀도로 칩 실루엣을 아래로 압출해 옆면 두께를 표현한다 */
.casino-chip--stacked {
  filter: drop-shadow(0 var(--side-th) 0 var(--side-color)) drop-shadow(0 2px 2px rgba(0, 0, 0, 0.4));
}
</style>
