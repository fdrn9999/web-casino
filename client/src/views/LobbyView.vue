<script setup>
import { onMounted, ref } from 'vue'
import { connectSocket } from '../composables/useSocket'
import NoticeBoard from '../components/NoticeBoard.vue'
import ReliefModal from '../components/ReliefModal.vue'
import JackpotWidget from '../components/JackpotWidget.vue'
import TableList from '../components/TableList.vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const reliefModal = ref(null)
const bonusMsg = ref('')

async function claimDaily() {
  try {
    const res = await api('/bonus/daily', { method: 'POST' })
    auth.setBalance(res.balance)
    bonusMsg.value = `출석 보너스 ${res.amount.toLocaleString()}칩 지급!`
  } catch (e) {
    bonusMsg.value = e.message
  }
  setTimeout(() => (bonusMsg.value = ''), 3000)
}

const games = [
  { key: 'blackjack', name: '블랙잭', emoji: '🃏', desc: '딜러를 이겨라 (7석 라이브 테이블)', tables: true },
  { key: 'roulette', name: '룰렛', emoji: '🎡', desc: '유러피언 룰렛 라이브 테이블', tables: false },
  { key: 'baccarat', name: '바카라', emoji: '🀄', desc: '플레이어 vs 뱅커', tables: false },
  { key: 'slots', name: '슬롯머신', emoji: '🎰', desc: '프로그레시브 잭팟에 도전', to: '/slots' },
]

onMounted(() => connectSocket())
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <button class="rounded-lg bg-amber-500/90 px-3 py-1.5 text-sm font-bold text-emerald-950 hover:bg-amber-400"
        @click="claimDaily">🎁 출석 보너스</button>
      <button v-if="(auth.user?.balance ?? 0) < 100"
        class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-500"
        @click="reliefModal.show()">⚠️ 파산 구제 신청</button>
      <span v-if="bonusMsg" class="text-sm text-amber-300">{{ bonusMsg }}</span>
    </div>
    <NoticeBoard />
    <ReliefModal ref="reliefModal" />

    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <component
        :is="g.to ? 'RouterLink' : 'div'"
        v-for="g in games"
        :key="g.key"
        :to="g.to"
        class="rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-5"
        :class="(g.to || g.tables) ? 'hover:border-amber-400/50' : 'opacity-80'"
      >
        <div class="text-3xl">{{ g.emoji }}</div>
        <h2 class="mt-2 text-lg font-bold text-amber-300">{{ g.name }}</h2>
        <p class="mt-1 text-xs text-emerald-300">{{ g.desc }}</p>
        <TableList v-if="g.tables" :game="g.key" />
        <span v-else-if="!g.to" class="mt-3 inline-block rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-300">준비 중</span>
      </component>
    </section>

    <JackpotWidget />
  </div>
</template>
