<script setup>
defineProps({
  balance: { type: Number, default: 0 },
  myBet: { type: Number, default: 0 },
  statusLabel: { type: String, default: '' },
  limitLabel: { type: String, default: '' },
})
</script>

<template>
  <!-- 푸터 바가 아니라, 게임 화면 우하단에 붙는 컴팩트한 플로팅 위젯 -->
  <div class="pointer-events-none fixed bottom-3 right-3 z-40 flex justify-end">
    <div class="pointer-events-auto flex flex-col items-end gap-1 rounded-2xl border border-amber-500/40 bg-emerald-950/90 px-4 py-2 shadow-[0_6px_24px_rgba(0,0,0,0.5)] backdrop-blur">
      <div class="flex items-center gap-3 text-sm font-bold tabular-nums">
        <span class="flex items-center gap-1 text-amber-300">
          <span aria-hidden="true">💰</span>{{ (balance ?? 0).toLocaleString() }}</span>
        <span class="h-3.5 w-px bg-emerald-700" aria-hidden="true"></span>
        <span class="flex items-center gap-1 text-emerald-200">
          <span aria-hidden="true">🎯</span>{{ (myBet ?? 0).toLocaleString() }}</span>
      </div>
      <div v-if="statusLabel || limitLabel" class="flex items-center gap-1.5 text-[10px] leading-tight">
        <span v-if="statusLabel" class="rounded-full bg-emerald-800 px-2 py-0.5 text-emerald-200">{{ statusLabel }}</span>
        <span v-if="limitLabel" class="text-emerald-400/80">{{ limitLabel }}</span>
      </div>
    </div>
  </div>
</template>
