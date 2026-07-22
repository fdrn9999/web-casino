<script setup>
// 모든 게임(블랙잭·룰렛·바카라)이 공유하는 베팅 편의 버튼 행 — 최대(올인)·되돌리기·전체취소·직전베팅.
// 라벨/스타일/순서/동작을 한 곳에서 통일한다. 각 게임은 핸들러와 활성화 여부만 넘긴다.
defineProps({
  sending: { type: Boolean, default: false },
  showMax: { type: Boolean, default: true },
  canMax: { type: Boolean, default: false },
  maxLabel: { type: String, default: '여유분 전부 베팅(올인)' },
  canUndo: { type: Boolean, default: false },
  canClear: { type: Boolean, default: false },
  showRepeat: { type: Boolean, default: true },
  canRepeat: { type: Boolean, default: false },
  repeatLabel: { type: String, default: '직전 베팅 재현' },
})
const emit = defineEmits(['max', 'undo', 'clear', 'repeat'])
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-2">
    <button v-if="showMax" type="button" :disabled="!canMax || sending"
      class="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-30"
      :title="maxLabel" @click="emit('max')">⬆ 최대</button>
    <button type="button" :disabled="!canUndo || sending"
      class="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-30"
      title="마지막 베팅 1건 되돌리기(환불)" @click="emit('undo')">⌫ 되돌리기</button>
    <button type="button" :disabled="!canClear || sending"
      class="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
      title="이번 라운드 내 베팅 전부 취소(환불)" @click="emit('clear')">✕ 전체 취소</button>
    <button v-if="showRepeat" type="button" :disabled="!canRepeat || sending"
      class="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-30"
      :title="repeatLabel" @click="emit('repeat')">↺ 직전 베팅</button>
  </div>
</template>
