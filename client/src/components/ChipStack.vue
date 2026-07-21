<script setup>
import { computed } from 'vue'
import CasinoChip from './CasinoChip.vue'
import { chipBreakdown } from '../lib/chips'

// 누적 베팅액을 실제 칩 더미처럼 "액면 자동 병합"하여 보여주는 프레젠테이션 전용 컴포넌트.
// 사운드는 여기서 재생하지 않는다 — 반응형 리렌더마다 울리면 안 되므로, 클릭 핸들러(뷰)에서
// sfx.chip()/sfx.chipStack()을 직접 호출한다.
const props = defineProps({
  amount: { type: Number, default: 0 },
  size: { type: Number, default: 32 },
  maxChips: { type: Number, default: 6 },
  showLabel: { type: Boolean, default: true },
})

// 큰 액면이 배열 앞쪽(0번) — 더미의 맨 아래에 그린다.
const chips = computed(() => chipBreakdown(props.amount, { maxChips: props.maxChips }))
// 칩끼리 살짝 겹치도록 하는 세로 오프셋(더미가 비스듬히 보이는 느낌)
const offset = computed(() => Math.max(5, Math.round(props.size * 0.22)))
const pileHeight = computed(() => props.size + offset.value * Math.max(chips.value.length - 1, 0))
</script>

<template>
  <div class="chip-stack inline-flex flex-col items-center" role="img" :aria-label="`${amount.toLocaleString()}칩`">
    <div v-if="chips.length" class="chip-stack-pile relative" :style="{ width: `${size}px`, height: `${pileHeight}px` }">
      <TransitionGroup name="chip-settle" tag="div">
        <CasinoChip
          v-for="(v, i) in chips"
          :key="i"
          :value="v"
          :size="size"
          class="chip-stack-layer"
          :style="{ bottom: `${i * offset}px`, zIndex: i }"
        />
      </TransitionGroup>
    </div>
    <span v-if="showLabel && amount > 0" class="chip-stack-label">{{ amount.toLocaleString() }}</span>
  </div>
</template>

<style scoped>
.chip-stack-pile {
  transition: height 0.15s ease;
}
.chip-stack-layer {
  position: absolute;
  left: 0;
  transition: bottom 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.chip-stack-label {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  color: #fde68a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
}

/* 새 칩 레이어가 더미에 얹힐 때의 "정착" 바운스 */
.chip-settle-enter-active {
  animation: chip-settle-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes chip-settle-in {
  0% {
    transform: translateY(-12px) scale(0.85);
    opacity: 0;
  }
  60% {
    transform: translateY(2px) scale(1.03);
    opacity: 1;
  }
  100% {
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chip-stack-pile,
  .chip-stack-layer {
    transition: none !important;
  }
  .chip-settle-enter-active {
    animation: none !important;
  }
}
</style>
