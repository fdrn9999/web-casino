<script setup>
defineProps({
  balance: { type: Number, default: 0 },
  myBet: { type: Number, default: 0 },
  statusLabel: { type: String, default: '' },
  limitLabel: { type: String, default: '' },
})
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-40 border-t border-amber-500/40 bg-emerald-950/95 px-2 py-1.5 shadow-[0_-2px_12px_rgba(0,0,0,0.45)] backdrop-blur sm:px-4"
  >
    <div class="mx-auto flex max-w-4xl flex-col gap-0.5">
      <div class="flex items-center justify-between gap-2 text-xs font-bold sm:text-sm">
        <span class="flex min-w-0 items-center gap-1 truncate text-amber-300">
          <span aria-hidden="true">💰</span>
          <span class="truncate">잔고 {{ (balance ?? 0).toLocaleString() }}칩</span>
        </span>
        <span class="flex min-w-0 items-center gap-1 truncate text-right text-emerald-200">
          <span class="truncate">이번 라운드 베팅 {{ (myBet ?? 0).toLocaleString() }}칩</span>
        </span>
      </div>
      <div class="flex items-center justify-center gap-1.5 text-[10px] leading-tight sm:gap-2 sm:text-xs">
        <span v-if="statusLabel" class="shrink-0 rounded-full bg-emerald-800 px-2 py-0.5 text-emerald-200">{{ statusLabel }}</span>
        <span v-if="limitLabel" class="min-w-0 truncate text-emerald-400">{{ limitLabel }}</span>
      </div>
    </div>
  </div>
</template>
