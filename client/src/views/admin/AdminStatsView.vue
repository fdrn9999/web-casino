<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../../lib/api'
import SimpleChart from '../../components/SimpleChart.vue'

const days = ref(30)
const stats = ref(null)
const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }

async function load() {
  stats.value = await api(`/admin/stats?days=${days.value}`)
}
watch(days, load)
onMounted(load)
</script>

<template>
  <div v-if="stats" class="space-y-6">
    <div class="flex gap-2">
      <button v-for="d in [7, 30, 0]" :key="d"
        class="rounded-lg px-3 py-1.5 text-sm"
        :class="days === d ? 'bg-amber-500 font-bold text-emerald-950' : 'bg-emerald-900 text-emerald-300'"
        @click="days = d">{{ d === 0 ? '전체' : `${d}일` }}</button>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">총 가입자</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.users.toLocaleString() }}</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">오늘 활동 유저</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.activeToday.toLocaleString() }}</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">총 베팅액</p>
        <p class="text-2xl font-black text-amber-300">{{ stats.totals.totalWagered.toLocaleString() }}칩</p>
      </div>
      <div class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <p class="text-xs text-emerald-400">하우스 손익</p>
        <p class="text-2xl font-black" :class="stats.totals.houseNet >= 0 ? 'text-amber-300' : 'text-red-400'">
          {{ stats.totals.houseNet.toLocaleString() }}칩</p>
      </div>
    </div>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">일별 베팅·지급 추이</h2>
      <SimpleChart type="line" :labels="stats.daily.map((r) => r.d)" :datasets="[
        { label: '베팅', data: stats.daily.map((r) => r.wagered), color: '#f59e0b' },
        { label: '지급', data: stats.daily.map((r) => r.paid), color: '#34d399' },
      ]" />
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">게임별 하우스 손익</h2>
        <SimpleChart type="bar" :labels="stats.byGame.map((g) => GAME_LABELS[g.game] ?? g.game)" :datasets="[
          { label: '하우스 손익', data: stats.byGame.map((g) => g.net), color: '#f59e0b' },
        ]" />
      </section>
      <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">파산 구제 추이</h2>
        <SimpleChart type="bar" :labels="stats.reliefDaily.map((r) => r.d)" :datasets="[
          { label: '구제 횟수', data: stats.reliefDaily.map((r) => r.count), color: '#ef4444' },
        ]" />
      </section>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">💎 잭팟 당첨 이력</h2>
        <table class="w-full min-w-[320px] text-xs">
          <tbody>
            <tr v-for="(j, i) in stats.jackpotHistory" :key="i" class="border-t border-emerald-900">
              <td class="p-1.5">{{ j.nickname }}</td>
              <td class="p-1.5 text-amber-300">{{ j.amount.toLocaleString() }}칩</td>
              <td class="p-1.5 text-emerald-400">{{ j.created_at }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!stats.jackpotHistory.length" class="text-xs text-emerald-500">아직 당첨자가 없습니다.</p>
      </section>
      <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
        <h2 class="mb-2 text-sm font-bold text-amber-300">베팅 상위 유저</h2>
        <table class="w-full min-w-[320px] text-xs">
          <tbody>
            <tr v-for="u in stats.topUsers" :key="u.username" class="border-t border-emerald-900">
              <td class="p-1.5">{{ u.nickname }} ({{ u.username }})</td>
              <td class="p-1.5">{{ u.total_wagered.toLocaleString() }}칩</td>
              <td class="p-1.5" :class="u.net >= 0 ? 'text-emerald-300' : 'text-red-400'">
                {{ u.net.toLocaleString() }}칩</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
