<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'
import PhaseTimer from '../components/PhaseTimer.vue'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('baccarat')

const state = ref(null)
const error = ref('')
const amount = ref(100)
const CHIPS = [100, 500, 1000, 5000]

const KIND_BUTTONS = computed(() => [
  { kind: 'ppair', label: 'P 페어', pay: `${state.value?.rules.pairPayout}:1`, cls: 'bg-sky-900' },
  { kind: 'player', label: '플레이어', pay: '1:1', cls: 'bg-sky-700' },
  { kind: 'tie', label: '타이', pay: `${state.value?.rules.tiePayout}:1`, cls: 'bg-emerald-700' },
  { kind: 'banker', label: '뱅커', pay: '0.95:1', cls: 'bg-red-700' },
  { kind: 'bpair', label: 'B 페어', pay: `${state.value?.rules.pairPayout}:1`, cls: 'bg-red-900' },
])
const OUTCOME_LABELS = { player: '플레이어 승!', banker: '뱅커 승!', tie: '타이!' }
const PHASE_LABELS = { waiting: '대기 중', betting: '베팅하세요!', revealing: '카드 공개', result: '결과' }
const BEAD = { player: 'bg-sky-500', banker: 'bg-red-500', tie: 'bg-emerald-500' }

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'revealing' && state.value?.phase !== 'revealing') sfx.deal()
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const mine = s.bets.some((b) => b.nickname === auth.user?.nickname)
      if (mine) sfx.win()
    }
    state.value = s
  })
})
onUnmounted(() => game.disconnect())

async function bet(kind) {
  error.value = ''
  sfx.chip()
  const res = await game.emitAck('bet:place', { kind, amount: amount.value })
  if (res.error) error.value = res.error
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🀄 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 카드 -->
    <section class="grid grid-cols-2 gap-3">
      <div class="rounded-2xl border border-sky-500/30 bg-emerald-900/50 p-4 text-center">
        <p class="text-xs font-bold text-sky-300">플레이어
          <b v-if="state.result" class="text-lg">{{ state.result.playerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.player ?? []" :key="i" :code="card.code" />
        </div>
      </div>
      <div class="rounded-2xl border border-red-500/30 bg-emerald-900/50 p-4 text-center">
        <p class="text-xs font-bold text-red-300">뱅커
          <b v-if="state.result" class="text-lg">{{ state.result.bankerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.banker ?? []" :key="i" :code="card.code" />
        </div>
      </div>
    </section>

    <p v-if="state.phase === 'result' && state.result" class="text-center text-xl font-black text-amber-400">
      {{ OUTCOME_LABELS[state.result.outcome] }}
      <span v-if="state.result.playerPair" class="ml-2 text-sm text-sky-300">P페어!</span>
      <span v-if="state.result.bankerPair" class="ml-2 text-sm text-red-300">B페어!</span>
    </p>

    <!-- 히스토리 -->
    <div class="flex flex-wrap gap-1">
      <span v-for="(h, i) in state.history" :key="i" class="h-4 w-4 rounded-full" :class="BEAD[h]" />
    </div>

    <!-- 베팅 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="grid grid-cols-5 gap-2">
        <button v-for="b in KIND_BUTTONS" :key="b.kind" :disabled="state.phase !== 'betting'"
          class="rounded-xl p-2 text-center text-white hover:opacity-80 disabled:opacity-40" :class="b.cls"
          @click="bet(b.kind)">
          <span class="block text-xs font-bold sm:text-sm">{{ b.label }}</span>
          <span class="block text-[10px] opacity-80">{{ b.pay }}</span>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v"
          class="rounded-full border-2 px-3 py-2 text-xs font-bold"
          :class="amount === v ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-800'"
          @click="amount = v; sfx.click()">{{ v.toLocaleString() }}</button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">{{ b.nickname }} — {{ b.kind }} · {{ b.amount.toLocaleString() }}칩</p>
      </div>
    </section>
  </div>
</template>
