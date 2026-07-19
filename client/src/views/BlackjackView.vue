<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'
import FloatingText from '../components/FloatingText.vue'
import PhaseTimer from '../components/PhaseTimer.vue'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('blackjack')

const state = ref(null)
const error = ref('')
const betAmount = ref(0)
const CHIPS = [100, 500, 1000, 5000]
const floating = ref(null)

const mySeatIdx = computed(() => state.value?.seats.findIndex((s) => s?.userId === auth.user?.id) ?? -1)
const mySeat = computed(() => (mySeatIdx.value >= 0 ? state.value.seats[mySeatIdx.value] : null))
const isMyTurn = computed(() => state.value?.phase === 'acting' && state.value.currentSeat === mySeatIdx.value)
const myHand = computed(() => (isMyTurn.value ? mySeat.value.hands[mySeat.value.activeHand] : null))

const PHASE_LABELS = {
  waiting: '플레이어를 기다리는 중', betting: '베팅하세요!', acting: '플레이 진행 중',
  dealer: '딜러 차례', result: '결과 발표',
}
const OUTCOME_LABELS = {
  blackjack: '블랙잭!', win: '승리', push: '무승부', lose: '패배', bust: '버스트', surrender: '서렌더',
}

let prevCardCount = 0
function totalCards(s) {
  return s.dealer.cards.length + s.seats.reduce((n, seat) => n + (seat?.hands.reduce((m, h) => m + h.cards.length, 0) ?? 0), 0)
}

// push(무승부)는 payout>0(환급)이어도 승리가 아님 — 실제 승리는 outcome이 win/blackjack일 때뿐
function isWinOutcome(outcome) {
  return outcome === 'win' || outcome === 'blackjack'
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
    prevCardCount = totalCards(state.value)
  } catch {
    return
  }
  game.onState((s) => {
    const count = totalCards(s)
    if (count > prevCardCount) sfx.deal()
    prevCardCount = count
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const mine = s.seats.find((seat) => seat?.userId === auth.user?.id)
      const won = mine?.hands.some((h) => h.result && isWinOutcome(h.result.outcome))
      const allPush = mine?.hands.length > 0 && mine.hands.every((h) => h.result?.outcome === 'push')
      if (mine?.bet > 0) (won ? sfx.win() : sfx.lose())
      if (mine?.bet > 0) {
        if (won) {
          const total = mine.hands.reduce((sum, h) => sum + (h.result?.payout ?? 0), 0)
          floating.value?.show(`+${total.toLocaleString()}칩`, 'win')
        } else if (!allPush) {
          floating.value?.show('아쉽네요…', 'lose')
        }
        // 전부 push(무승부)인 경우: 승리 연출을 띄우지 않음 (정직한 결과 표시)
      }
    }
    state.value = s
  })
})
onUnmounted(() => game.disconnect())

async function act(event, payload) {
  error.value = ''
  const res = await game.emitAck(event, payload)
  if (res.error) error.value = res.error
  return res
}

function sit(seatIdx) {
  sfx.click()
  act('seat:join', { seat: seatIdx })
}
async function leaveSeat() {
  sfx.click()
  await act('seat:leave')
}
function addChip(v) {
  sfx.chip()
  const { minBet, maxBet } = state.value.rules
  betAmount.value = Math.min(maxBet, betAmount.value + v)
  if (betAmount.value < minBet) betAmount.value = minBet
}
async function confirmBet() {
  const res = await act('bet:place', { amount: betAmount.value })
  if (res.ok) betAmount.value = 0
}
function doAction(move) {
  sfx.click()
  act('action', { move })
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🃏 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-200">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">베팅 {{ state.rules.minBet.toLocaleString() }}~{{ state.rules.maxBet.toLocaleString() }}칩</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt"
      :total-seconds="state.phase === 'betting' ? state.rules.betSeconds : state.rules.turnSeconds" />

    <div class="relative"><FloatingText ref="floating" /></div>

    <!-- 딜러 -->
    <section class="rounded-2xl border border-amber-500/20 bg-emerald-900/50 p-4 text-center">
      <p class="mb-2 text-xs text-emerald-300">딜러 <b v-if="state.dealer.total" class="text-amber-300">{{ state.dealer.total }}</b></p>
      <div class="flex justify-center gap-1.5">
        <CardImg v-for="(card, i) in state.dealer.cards" :key="i" :code="card.code" />
        <p v-if="state.dealer.cards.length === 0" class="text-sm text-emerald-500">대기 중</p>
      </div>
    </section>

    <!-- 좌석 -->
    <section class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <div v-for="(seat, i) in state.seats" :key="i"
        class="rounded-xl border p-2 text-center"
        :class="[
          state.currentSeat === i ? 'border-amber-400 bg-amber-500/10 fx-pulse-gold' : 'border-emerald-800 bg-emerald-900/40',
          state.phase === 'result' && seat?.hands.some((h) => h.result && isWinOutcome(h.result.outcome)) ? 'fx-glow-win' : '',
        ]">
        <template v-if="seat">
          <p class="truncate text-xs font-bold" :class="seat.userId === auth.user?.id ? 'text-amber-300' : 'text-emerald-200'">
            {{ seat.nickname }}</p>
          <p v-if="seat.bet" class="text-xs text-emerald-400">{{ seat.bet.toLocaleString() }}칩</p>
          <div v-for="(hand, hi) in seat.hands" :key="hi" class="mt-1"
            :class="seat.activeHand === hi && state.currentSeat === i ? 'ring-1 ring-amber-400 rounded' : ''">
            <div class="flex flex-wrap justify-center gap-0.5">
              <CardImg v-for="(card, ci) in hand.cards" :key="ci" :code="card.code" class="!w-8 sm:!w-10" />
            </div>
            <p class="text-xs text-emerald-300">{{ hand.total }}<span v-if="hand.soft"> (소프트)</span></p>
            <p v-if="hand.result" class="text-xs font-bold"
              :class="isWinOutcome(hand.result.outcome) ? 'text-amber-300' : hand.result.outcome === 'push' ? 'text-emerald-300' : 'text-red-400'">
              {{ OUTCOME_LABELS[hand.result.outcome] }}
              <template v-if="isWinOutcome(hand.result.outcome)"> +{{ hand.result.payout.toLocaleString() }}</template>
            </p>
          </div>
          <button v-if="seat.userId === auth.user?.id" class="mt-1 text-xs text-red-400 hover:underline" @click="leaveSeat">
            떠나기</button>
        </template>
        <button v-else class="w-full py-3 text-xs text-emerald-500 hover:text-amber-300" @click="sit(i)">+ 앉기</button>
      </div>
    </section>

    <!-- 조작 -->
    <section v-if="mySeat" class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div v-if="state.phase === 'betting' && mySeat.bet === 0" class="flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v" class="rounded-full border-2 border-amber-400/60 bg-emerald-950 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-emerald-800"
          @click="addChip(v)">{{ v.toLocaleString() }}</button>
        <span class="ml-2 font-bold tabular-nums text-amber-300">{{ betAmount.toLocaleString() }}칩</span>
        <button class="rounded-lg px-2 py-1 text-xs text-emerald-400 hover:text-red-400" @click="betAmount = 0">지우기</button>
        <button :disabled="betAmount === 0"
          class="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
          @click="confirmBet">베팅 확정</button>
      </div>
      <div v-else-if="isMyTurn && myHand" class="flex flex-wrap justify-center gap-2">
        <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500" @click="doAction('hit')">히트</button>
        <button class="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold hover:bg-emerald-700" @click="doAction('stand')">스탠드</button>
        <button v-if="state.rules.doubleAllowed && myHand.cards.length === 2"
          class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold hover:bg-amber-500" @click="doAction('double')">더블</button>
        <button v-if="state.rules.splitAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2 && myHand.cards[0].code.slice(0, -1) === myHand.cards[1].code.slice(0, -1)"
          class="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold hover:bg-purple-500" @click="doAction('split')">스플릿</button>
        <button v-if="state.rules.surrenderAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2"
          class="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold hover:bg-red-600" @click="doAction('surrender')">서렌더</button>
      </div>
      <p v-else class="text-center text-sm text-emerald-400">{{ PHASE_LABELS[state.phase] }}…</p>
      <p v-if="error" class="mt-2 text-center text-sm text-red-400">{{ error }}</p>
    </section>
    <p v-else class="text-center text-sm text-emerald-400">빈 좌석을 눌러 참가하세요.</p>
  </div>
</template>
