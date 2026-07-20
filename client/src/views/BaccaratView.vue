<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'
import FloatingText from '../components/FloatingText.vue'
import PhaseTimer from '../components/PhaseTimer.vue'
import TableChat from '../components/TableChat.vue'
import TableHud from '../components/TableHud.vue'
import ChipTray from '../components/ChipTray.vue'
import CasinoChip from '../components/CasinoChip.vue'
import WinCascade from '../components/WinCascade.vue'
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
const sending = ref(false)
const chipValue = ref(100) // 활성 칩(현재 선택된 베팅 단위)
const floating = ref(null)
const cascade = ref(null)

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
const myBets = computed(() => state.value?.bets.filter((b) => b.nickname === auth.user?.nickname) ?? [])
const myBetTotal = computed(() => myBets.value.reduce((sum, b) => sum + b.amount, 0))
const myBetByKind = computed(() => {
  const totals = {}
  for (const b of myBets.value) totals[b.kind] = (totals[b.kind] ?? 0) + b.amount
  return totals
})
const limitLabel = computed(() =>
  state.value
    ? `뱅커 0.95:1 · 타이 ${state.value.rules.tiePayout}:1 · ${state.value.rules.minBet.toLocaleString()}~${state.value.rules.maxBet.toLocaleString()}칩`
    : ''
)

// --- 직전 베팅 다시 걸기 ---
const LAST_BET_KEY = `vegas:lastBet:baccarat:${route.params.tableId}`
const roundBets = ref([]) // 이번 베팅 페이즈 동안 내가 실제로 성공시킨 베팅들
const lastRoundBets = ref(loadLastBets())
function loadLastBets() {
  try {
    const raw = localStorage.getItem(LAST_BET_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
const lastRoundTotal = computed(() => lastRoundBets.value.reduce((sum, b) => sum + b.amount, 0))
const canRepeatLastBet = computed(() =>
  lastRoundBets.value.length > 0 && lastRoundTotal.value > 0 && lastRoundTotal.value <= (auth.user?.balance ?? 0)
)

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'revealing' && state.value?.phase !== 'revealing') sfx.deal()
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const myKinds = s.bets.filter((b) => b.nickname === auth.user?.nickname).map((b) => b.kind)
      if (myKinds.length) {
        const won = myKinds.includes(s.result.outcome)
          || (myKinds.includes('ppair') && s.result.playerPair)
          || (myKinds.includes('bpair') && s.result.bankerPair)
        floating.value?.show(won ? '적중!' : '아쉽네요…', won ? 'win' : 'lose')
        if (won) {
          sfx.win()
          cascade.value?.burst()
        } else {
          sfx.lose()
        }
      }
    }
    // 베팅 페이즈가 끝나는 시점에 이번 라운드 베팅 내역을 "직전 베팅"으로 저장
    if (state.value?.phase === 'betting' && s.phase !== 'betting' && roundBets.value.length > 0) {
      lastRoundBets.value = roundBets.value
      try {
        localStorage.setItem(LAST_BET_KEY, JSON.stringify(roundBets.value))
      } catch {
        // 저장 실패는 무시(사생활 모드 등)
      }
      roundBets.value = []
    }
    state.value = s
  })
})
onUnmounted(() => game.disconnect())

async function bet(kind, amountOverride) {
  // 라운드트립 중 중복 클릭 방지 (서버도 중복은 거부하지만 불필요한 요청/에러 노이즈를 줄임)
  if (sending.value) return
  sending.value = true
  error.value = ''
  const amt = amountOverride ?? chipValue.value
  sfx.chip()
  try {
    const res = await game.emitAck('bet:place', { kind, amount: amt })
    if (res.error) {
      error.value = res.error
    } else {
      roundBets.value = [...roundBets.value, { kind, amount: amt }]
    }
  } finally {
    sending.value = false
  }
}

async function repeatLastBet() {
  if (!canRepeatLastBet.value || sending.value) return
  for (const b of lastRoundBets.value) {
    // eslint-disable-next-line no-await-in-loop
    await bet(b.kind, b.amount)
    if (error.value) break
  }
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4 pb-20 lg:mr-80">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🀄 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-amber-500/80">바카라 · 뱅커 0.95:1</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 카드 -->
    <div class="relative"><FloatingText ref="floating" /></div>
    <section class="grid grid-cols-2 gap-3">
      <div class="rounded-2xl border border-sky-500/30 bg-emerald-900/50 p-4 text-center"
        :class="state.phase === 'result' && state.result?.outcome === 'player' ? 'fx-glow-win' : ''">
        <p class="text-xs font-bold text-sky-300">플레이어
          <b v-if="state.result" class="text-lg">{{ state.result.playerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.player ?? []" :key="i" :code="card.code" />
        </div>
      </div>
      <div class="rounded-2xl border border-red-500/30 bg-emerald-900/50 p-4 text-center"
        :class="state.phase === 'result' && state.result?.outcome === 'banker' ? 'fx-glow-win' : ''">
        <p class="text-xs font-bold text-red-300">뱅커
          <b v-if="state.result" class="text-lg">{{ state.result.bankerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in state.result?.banker ?? []" :key="i" :code="card.code" />
        </div>
      </div>
    </section>

    <p v-if="state.phase === 'result' && state.result" class="fx-pop text-center text-xl font-black text-amber-400">
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
        <button v-for="b in KIND_BUTTONS" :key="b.kind" :disabled="state.phase !== 'betting' || sending"
          class="relative rounded-xl p-2 text-center text-white hover:opacity-80 disabled:opacity-40" :class="b.cls"
          @click="bet(b.kind)">
          <span class="block text-xs font-bold sm:text-sm">{{ b.label }}</span>
          <span class="block text-[10px] opacity-80">{{ b.pay }}</span>
          <span v-if="myBetByKind[b.kind]" class="mt-1 flex items-center justify-center gap-0.5 text-[10px] font-bold text-amber-300">
            <CasinoChip :value="myBetByKind[b.kind]" :size="16" />{{ myBetByKind[b.kind].toLocaleString() }}
          </span>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap items-end gap-3">
        <ChipTray v-model="chipValue" :disabled="state.phase !== 'betting' || sending" />
        <button v-if="state.phase === 'betting'" :disabled="!canRepeatLastBet || sending"
          class="rounded-lg border border-amber-500/50 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-30"
          :title="canRepeatLastBet ? `직전 베팅 재현 (총 ${lastRoundTotal.toLocaleString()}칩)` : '재현할 직전 베팅이 없거나 잔액이 부족합니다.'"
          @click="repeatLastBet">↺ 직전 베팅</button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">{{ b.nickname }} — {{ b.kind }} · {{ b.amount.toLocaleString() }}칩</p>
      </div>
    </section>

    <div class="mt-6 lg:mt-0">
      <TableChat :game="game" />
    </div>
    <WinCascade ref="cascade" />
    <TableHud :balance="auth.user?.balance ?? 0" :my-bet="myBetTotal" :status-label="PHASE_LABELS[state.phase]" :limit-label="limitLabel" />
  </div>
</template>
