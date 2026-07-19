<script setup>
import { onMounted } from 'vue'
import { connectSocket } from '../composables/useSocket'

const games = [
  { key: 'blackjack', name: '블랙잭', emoji: '🃏', desc: '딜러를 이겨라 (7석 라이브 테이블)' },
  { key: 'roulette', name: '룰렛', emoji: '🎡', desc: '유러피언 룰렛 라이브 테이블' },
  { key: 'baccarat', name: '바카라', emoji: '🀄', desc: '플레이어 vs 뱅커' },
  { key: 'slots', name: '슬롯머신', emoji: '🎰', desc: '프로그레시브 잭팟에 도전' },
]

onMounted(() => connectSocket())
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm text-emerald-300">
      📢 공지사항 영역 (플랜 2에서 구현)
    </section>

    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="g in games"
        :key="g.key"
        class="rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-5 opacity-80"
      >
        <div class="text-3xl">{{ g.emoji }}</div>
        <h2 class="mt-2 text-lg font-bold text-amber-300">{{ g.name }}</h2>
        <p class="mt-1 text-xs text-emerald-300">{{ g.desc }}</p>
        <span class="mt-3 inline-block rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-300">준비 중</span>
      </div>
    </section>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm text-emerald-300">
      💎 잭팟 위젯 영역 (플랜 3에서 구현)
    </section>
  </div>
</template>
