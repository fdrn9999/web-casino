<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import SimpleChart from '../components/SimpleChart.vue'

const auth = useAuthStore()
const stats = ref(null)
const loading = ref(false)
const error = ref('')

const TYPE_LABELS = {
  signup_bonus: '가입 보너스', daily_bonus: '출석 보너스', bankrupt_relief: '파산 구제',
  bet: '베팅', payout: '당첨 지급', admin_grant: '운영자 지급', admin_confiscate: '운영자 몰수', jackpot: '잭팟',
}
const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await api('/me/stats')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-if="loading" class="py-10 text-center text-sm text-emerald-300">불러오는 중…</div>
  <div v-else-if="error" class="mx-auto max-w-3xl rounded-lg bg-red-950/50 p-4 text-center text-sm text-red-300">
    <p>{{ error }}</p>
    <button class="mt-3 rounded-lg bg-red-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700" @click="load">다시 시도</button>
  </div>
  <div v-else-if="stats" class="mx-auto max-w-3xl space-y-4">
    <h1 class="text-xl font-bold text-amber-400">👤 {{ auth.user?.nickname }}의 마이페이지</h1>

    <section class="rounded-2xl border p-5 text-center"
      :class="stats.totals.net < 0 ? 'border-red-500/40 bg-red-950/30' : 'border-emerald-800 bg-emerald-900/40'">
      <p class="text-sm text-emerald-300">지금까지의 결과</p>
      <p class="mt-1 text-3xl font-black" :class="stats.totals.net < 0 ? 'text-red-400' : 'text-amber-300'">
        {{ stats.totals.net < 0 ? `총 ${Math.abs(stats.totals.net).toLocaleString()}칩 손실`
          : `총 ${stats.totals.net.toLocaleString()}칩 이득` }}
      </p>
      <div class="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><p class="text-xs text-emerald-400">총 베팅</p><p class="font-bold">{{ stats.totals.totalWagered.toLocaleString() }}칩</p></div>
        <div><p class="text-xs text-emerald-400">총 획득</p><p class="font-bold">{{ stats.totals.totalWon.toLocaleString() }}칩</p></div>
        <div><p class="text-xs text-emerald-400">파산 횟수</p><p class="font-bold text-red-400">{{ stats.totals.bankruptCount }}회</p></div>
      </div>
      <p v-if="stats.totals.net < 0" class="mt-3 rounded bg-red-950/50 p-2 text-xs text-red-300">
        가상머니라서 다행입니다. 실제 도박이었다면 이 돈은 돌아오지 않습니다.
      </p>
    </section>

    <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">최근 30일 일별 순손익</h2>
      <SimpleChart type="bar" :labels="stats.daily.map((r) => r.d)" :datasets="[
        { label: '순손익', data: stats.daily.map((r) => r.net), color: '#f59e0b' },
      ]" />
    </section>

    <section class="overflow-x-auto rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
      <h2 class="mb-2 text-sm font-bold text-amber-300">최근 거래</h2>
      <table class="w-full min-w-[420px] text-xs">
        <tbody>
          <tr v-for="(t, i) in stats.recent" :key="i" class="border-t border-emerald-900">
            <td class="p-1.5 text-emerald-400">{{ t.created_at }}</td>
            <td class="p-1.5">{{ TYPE_LABELS[t.type] ?? t.type }}<template v-if="t.game"> ({{ GAME_LABELS[t.game] }})</template></td>
            <td class="p-1.5 text-right" :class="t.amount >= 0 ? 'text-emerald-300' : 'text-red-400'">
              {{ t.amount >= 0 ? '+' : '' }}{{ t.amount.toLocaleString() }}칩</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
