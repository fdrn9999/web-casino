<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'

const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }

const data = ref(null)
const error = ref('')

onMounted(async () => {
  try {
    data.value = await api('/leaderboard')
  } catch (e) {
    error.value = e.message
  }
})
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <h1 class="text-xl font-bold text-amber-400">🏆 명예의 전당</h1>

    <p v-if="error" class="rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{{ error }}</p>

    <div v-if="data" class="space-y-6">
      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-3 text-sm font-bold text-amber-300">💰 부자 랭킹</h2>
        <table class="w-full min-w-[420px] text-sm">
          <thead>
            <tr class="text-left text-xs text-emerald-400">
              <th class="p-1.5">순위</th>
              <th class="p-1.5">닉네임</th>
              <th class="p-1.5">아이디</th>
              <th class="p-1.5 text-right">보유 칩</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(u, i) in data.richest" :key="i" class="border-t border-emerald-900">
              <td class="p-1.5 font-bold text-amber-300">{{ i + 1 }}</td>
              <td class="p-1.5">{{ u.nickname }}</td>
              <td class="p-1.5 text-emerald-400">{{ u.username }}</td>
              <td class="p-1.5 text-right font-semibold text-amber-200">{{ u.balance.toLocaleString() }}칩</td>
            </tr>
            <tr v-if="!data.richest.length">
              <td colspan="4" class="p-3 text-center text-xs text-emerald-400">기록이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-3 text-sm font-bold text-amber-300">🎉 최대 당첨</h2>
        <table class="w-full min-w-[480px] text-sm">
          <thead>
            <tr class="text-left text-xs text-emerald-400">
              <th class="p-1.5">순위</th>
              <th class="p-1.5">닉네임</th>
              <th class="p-1.5">게임</th>
              <th class="p-1.5">일시</th>
              <th class="p-1.5 text-right">당첨금</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, i) in data.biggestWins" :key="i" class="border-t border-emerald-900">
              <td class="p-1.5 font-bold text-amber-300">{{ i + 1 }}</td>
              <td class="p-1.5">{{ w.nickname }}</td>
              <td class="p-1.5 text-emerald-300">{{ GAME_LABELS[w.game] ?? w.game }}</td>
              <td class="p-1.5 text-emerald-400">{{ w.created_at }}</td>
              <td class="p-1.5 text-right font-semibold text-amber-200">{{ w.amount.toLocaleString() }}칩</td>
            </tr>
            <tr v-if="!data.biggestWins.length">
              <td colspan="5" class="p-3 text-center text-xs text-emerald-400">기록이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="overflow-x-auto rounded-xl border border-red-500/30 bg-red-950/20 p-4">
        <h2 class="mb-3 text-sm font-bold text-red-400">⚠️ 최대 손실</h2>
        <p class="mb-3 rounded bg-red-950/50 p-2 text-xs text-red-300">
          도박의 끝은 대부분 손실입니다 — 이 순위에 오르지 않기를 바랍니다.
        </p>
        <table class="w-full min-w-[360px] text-sm">
          <thead>
            <tr class="text-left text-xs text-emerald-400">
              <th class="p-1.5">순위</th>
              <th class="p-1.5">닉네임</th>
              <th class="p-1.5 text-right">순손실</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in data.biggestLosers" :key="i" class="border-t border-emerald-900">
              <td class="p-1.5 font-bold text-amber-300">{{ i + 1 }}</td>
              <td class="p-1.5">{{ l.nickname }}</td>
              <td class="p-1.5 text-right font-semibold text-red-400">-{{ l.netLoss.toLocaleString() }}칩</td>
            </tr>
            <tr v-if="!data.biggestLosers.length">
              <td colspan="3" class="p-3 text-center text-xs text-emerald-400">기록이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
