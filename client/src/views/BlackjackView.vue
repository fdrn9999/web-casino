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
const game = useGameSocket('blackjack')

const state = ref(null)
const error = ref('')
const sending = ref(false)
const betAmount = ref(0)
const betChips = ref([]) // 확정 전, 좌석에 쌓인 칩(액면가 배열) — 스택 시각화용
const chipValue = ref(100) // 활성 칩(현재 선택된 베팅 단위)
const floating = ref(null)
const cascade = ref(null)

const mySeatIdx = computed(() => state.value?.seats.findIndex((s) => s?.userId === auth.user?.id) ?? -1)
const mySeat = computed(() => (mySeatIdx.value >= 0 ? state.value.seats[mySeatIdx.value] : null))
const isMyTurn = computed(() => state.value?.phase === 'acting' && state.value.currentSeat === mySeatIdx.value)
const myHand = computed(() => (isMyTurn.value ? mySeat.value.hands[mySeat.value.activeHand] : null))
// 내 이번 라운드 총 베팅액: 더블은 핸드당 베팅액 2배, 스플릿은 핸드 수만큼 합산 (딜링 전에는 seat.bet 그대로)
const myBet = computed(() => {
  if (!mySeat.value || !mySeat.value.bet) return 0
  if (!mySeat.value.hands.length) return mySeat.value.bet
  return mySeat.value.hands.reduce((sum, h) => sum + (h.doubled ? mySeat.value.bet * 2 : mySeat.value.bet), 0)
})
const limitLabel = computed(() =>
  state.value ? `블랙잭 3:2 · ${state.value.rules.minBet.toLocaleString()}~${state.value.rules.maxBet.toLocaleString()}칩` : ''
)

// --- 직전 베팅 다시 걸기 ---
const LAST_BET_KEY = `vegas:lastBet:blackjack:${route.params.tableId}`
const lastRoundBet = ref(loadLastBet())
function loadLastBet() {
  try {
    return Number(localStorage.getItem(LAST_BET_KEY)) || 0
  } catch {
    return 0
  }
}
const canRepeatLastBet = computed(() =>
  !!mySeat.value && mySeat.value.bet === 0 && state.value?.phase === 'betting'
  && lastRoundBet.value > 0 && lastRoundBet.value <= (auth.user?.balance ?? 0)
)

const PHASE_LABELS = {
  waiting: '플레이어를 기다리는 중', betting: '베팅하세요!', acting: '플레이 진행 중',
  dealer: '딜러 차례', result: '결과 발표',
}
const OUTCOME_LABELS = {
  blackjack: '블랙잭!', win: '승리', push: '무승부', lose: '패배', bust: '버스트', surrender: '서렌더',
}

// push(무승부)는 payout>0(환급)이어도 승리가 아님 — 실제 승리는 outcome이 win/blackjack일 때뿐
function isWinOutcome(outcome) {
  return outcome === 'win' || outcome === 'blackjack'
}

// ─────────────────────────────────────────────────────────────────────────
// 한 장씩 순차 공개 레이어(progressive reveal)
// 서버 스냅샷(state)은 항상 최신·권위 있는 진실이다. 여기서 만드는 revealedDealer /
// revealedSeats 는 오직 "화면에 이미 보여준" 카드만 담는 지연(lag) 미러이며,
// 새 스냅샷이 revealedX보다 카드가 많으면 그 차이를 큐에 넣어 한 장씩(소리와 함께)
// 재생한다. 게임 로직/정산은 절대 이 레이어에서 파생되지 않는다.
// ─────────────────────────────────────────────────────────────────────────
const revealedDealer = ref([]) // Array<{code}>
const revealedSeats = ref([]) // Array<null | { hands: Array<{cards: Array<{code}>}> }>
// planned.*: "이미 큐에 넣었거나 반영한" 카드 수(아직 애니메이션 전이어도 포함) — 겹쳐 들어오는
// 스냅샷 사이에서 같은 카드를 중복으로 큐잉하지 않기 위한 내부 부기 장부(비반응형).
const planned = { dealerLen: 0, dealerFlipQueued: false, seats: [] }
let revealQueue = []
let revealTimer = null
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function resetPlannedSeat(i) {
  planned.seats[i] = { handsLen: [] }
}

// 새 라운드 진입(딜러 카드 0장) — 지연 없이 즉시 리셋. 잃을 애니메이션이 없다(빈 상태로 수렴).
function hardResetDisplay(s) {
  revealedDealer.value = []
  planned.dealerLen = 0
  planned.dealerFlipQueued = false
  revealedSeats.value = s.seats.map((seat) => (seat ? { hands: [] } : null))
  planned.seats = s.seats.map(() => ({ handsLen: [] }))
  revealQueue = []
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
}

// 페이지 접속 시점에 라운드가 이미 진행 중이면, 그 시점까지의 카드는 애니메이션 없이 즉시 스냅한다
// (내가 안 본 과거를 가짜로 "딜"하지 않는다). 이후 스냅샷부터 진짜 진행분만 한 장씩 공개된다.
function seedDisplay(s) {
  revealedDealer.value = s.dealer.cards.map((c) => ({ ...c }))
  planned.dealerLen = s.dealer.cards.length
  planned.dealerFlipQueued = !s.dealer.hidden
  revealedSeats.value = s.seats.map((seat) =>
    seat ? { hands: seat.hands.map((h) => ({ cards: h.cards.map((c) => ({ ...c })) })) } : null
  )
  planned.seats = s.seats.map((seat) => ({ handsLen: seat ? seat.hands.map((h) => h.cards.length) : [] }))
}

function applyStep(step) {
  if (step.kind === 'seat') {
    const rs = revealedSeats.value[step.seat]
    if (!rs) return
    if (!rs.hands[step.hand]) rs.hands[step.hand] = { cards: [] }
    rs.hands[step.hand].cards.push(step.card)
    sfx.cardDeal()
  } else if (step.kind === 'dealer') {
    revealedDealer.value.push(step.card)
    sfx.cardDeal()
  } else if (step.kind === 'dealerFlip') {
    revealedDealer.value.splice(step.index, 1, step.card)
    sfx.cardFlip()
  }
}

function tickQueue() {
  revealTimer = null
  if (revealQueue.length === 0) return
  const step = revealQueue.shift()
  applyStep(step)
  // 딜러의 드로우(홀카드 공개 이후)는 조금 더 뜸을 들여 서스펜스를 준다
  const delay = step.kind === 'dealerFlip' ? 480 : step.dealerDraw ? 520 : 340
  revealTimer = setTimeout(tickQueue, delay)
}

function enqueue(steps) {
  if (!steps.length) return
  if (prefersReduced) {
    steps.forEach(applyStep)
    return
  }
  const wasIdle = revealQueue.length === 0 && revealTimer === null
  revealQueue.push(...steps)
  if (wasIdle) tickQueue()
}

// 최초 딜: 좌석별 첫 카드 → 딜러 업카드 → 좌석별 둘째 카드 → 딜러 홀카드(뒷면) 순서로 스태거.
function buildFreshDealSteps(s) {
  const steps = []
  const activeSeats = []
  s.seats.forEach((seat, i) => {
    if (seat && seat.hands.length) activeSeats.push(i)
  })
  for (const i of activeSeats) {
    const c = s.seats[i].hands[0].cards[0]
    if (c) steps.push({ kind: 'seat', seat: i, hand: 0, card: c })
  }
  if (s.dealer.cards[0]) steps.push({ kind: 'dealer', card: s.dealer.cards[0] })
  for (const i of activeSeats) {
    const c = s.seats[i].hands[0].cards[1]
    if (c) steps.push({ kind: 'seat', seat: i, hand: 0, card: c })
  }
  if (s.dealer.cards[1]) steps.push({ kind: 'dealer', card: s.dealer.cards[1] })
  return steps
}

// 최초 딜 이후의 모든 진행(히트/더블/스플릿/딜러 드로우/홀카드 플립)을 증분 diff로 큐잉한다.
function diffAndEnqueue(s) {
  const steps = []
  const n = Math.max(s.seats.length, revealedSeats.value.length)
  for (let i = 0; i < n; i++) {
    const serverSeat = s.seats[i]
    if (!serverSeat) {
      revealedSeats.value[i] = null
      resetPlannedSeat(i)
      continue
    }
    if (!revealedSeats.value[i]) {
      revealedSeats.value[i] = { hands: [] }
      resetPlannedSeat(i)
    }
    const rSeat = revealedSeats.value[i]
    const pSeat = planned.seats[i] ?? (planned.seats[i] = { handsLen: [] })
    if (serverSeat.hands.length !== pSeat.handsLen.length) {
      if (pSeat.handsLen.length === 1 && serverSeat.hands.length === 2) {
        // 스플릿: 이미 보여준 2장을 각 핸드의 첫 장으로 즉시 재배치(애니메이션 불필요, 이미 본 카드다)
        const oldCards = rSeat.hands[0]?.cards ?? []
        rSeat.hands = [
          { cards: oldCards[0] ? [oldCards[0]] : [] },
          { cards: oldCards[1] ? [oldCards[1]] : [] },
        ]
        pSeat.handsLen = [oldCards[0] ? 1 : 0, oldCards[1] ? 1 : 0]
      } else {
        // 예상 밖의 구조 변화 — 안전하게 즉시 스냅 후 다음 좌석으로
        rSeat.hands = serverSeat.hands.map((h) => ({ cards: [...h.cards] }))
        pSeat.handsLen = serverSeat.hands.map((h) => h.cards.length)
        continue
      }
    }
    for (let hi = 0; hi < serverSeat.hands.length; hi++) {
      const targetLen = serverSeat.hands[hi].cards.length
      const already = pSeat.handsLen[hi] ?? 0
      for (let ci = already; ci < targetLen; ci++) {
        steps.push({ kind: 'seat', seat: i, hand: hi, card: serverSeat.hands[hi].cards[ci] })
      }
      pSeat.handsLen[hi] = targetLen
    }
  }
  // 딜러: 홀카드 플립(BACK→실카드, 길이 불변) 먼저, 이어서 새로 뽑힌 카드들을 순서대로
  const targetDealer = s.dealer.cards
  if (
    revealedDealer.value.length >= 2 &&
    revealedDealer.value[1]?.code === 'BACK' &&
    targetDealer[1] && targetDealer[1].code !== 'BACK' &&
    !planned.dealerFlipQueued
  ) {
    steps.push({ kind: 'dealerFlip', index: 1, card: targetDealer[1] })
    planned.dealerFlipQueued = true
  }
  const alreadyD = planned.dealerLen
  for (let ci = alreadyD; ci < targetDealer.length; ci++) {
    steps.push({ kind: 'dealer', card: targetDealer[ci], dealerDraw: ci >= 2 })
  }
  planned.dealerLen = Math.max(planned.dealerLen, targetDealer.length)
  enqueue(steps)
}

const dealerView = computed(() => {
  const cards = revealedDealer.value
  const server = state.value?.dealer
  if (!server) return { cards: [], total: null }
  const caughtUp = cards.length === server.cards.length && !cards.some((c) => c.code === 'BACK')
  return { cards, total: caughtUp ? server.total : null }
})

function seatCards(seatIdx, handIdx) {
  return revealedSeats.value[seatIdx]?.hands[handIdx]?.cards ?? []
}
function seatHandCaughtUp(seatIdx, handIdx) {
  const serverHand = state.value?.seats[seatIdx]?.hands[handIdx]
  if (!serverHand) return false
  return seatCards(seatIdx, handIdx).length === serverHand.cards.length
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
    seedDisplay(state.value)
  } catch {
    return
  }
  game.onState((s) => {
    // 진행 레이어를 최신 스냅샷에 수렴시킨다(항상 state.value=이전 스냅샷 기준으로 diff)
    if (s.dealer.cards.length === 0) {
      hardResetDisplay(s)
    } else if ((state.value?.dealer.cards.length ?? 0) === 0) {
      // 방금 새 라운드가 딜링됨 — 카지노 순서로 스태거 딜
      const steps = buildFreshDealSteps(s)
      s.seats.forEach((seat, i) => {
        if (seat && seat.hands.length) planned.seats[i] = { handsLen: [seat.hands[0].cards.length] }
        else resetPlannedSeat(i)
      })
      planned.dealerLen = s.dealer.cards.length
      planned.dealerFlipQueued = !s.dealer.hidden
      enqueue(steps)
    } else {
      diffAndEnqueue(s)
    }

    if (s.phase === 'result' && state.value?.phase !== 'result') {
      const mine = s.seats.find((seat) => seat?.userId === auth.user?.id)
      const won = mine?.hands.some((h) => h.result && isWinOutcome(h.result.outcome))
      const allPush = mine?.hands.length > 0 && mine.hands.every((h) => h.result?.outcome === 'push')
      if (mine?.bet > 0) {
        if (won) {
          sfx.win()
          cascade.value?.burst()
        } else {
          sfx.lose()
        }
      }
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
    // 새 베팅 페이즈가 시작되는 시점에, 직전 라운드 내 베팅액을 "직전 베팅"으로 저장
    if (s.phase === 'betting' && state.value?.phase !== 'betting') {
      const prevMine = state.value?.seats?.find((seat) => seat?.userId === auth.user?.id)
      if (prevMine?.bet > 0) {
        lastRoundBet.value = prevMine.bet
        try {
          localStorage.setItem(LAST_BET_KEY, String(prevMine.bet))
        } catch {
          // 저장 실패는 무시(사생활 모드 등)
        }
      }
    }
    state.value = s
  })
})
onUnmounted(() => {
  game.disconnect()
  if (revealTimer) clearTimeout(revealTimer)
  revealQueue = []
})

async function act(event, payload) {
  // 라운드트립 중 중복 클릭으로 같은 요청이 두 번 나가지 않도록 방지 (서버도 중복은 거부하지만, 불필요한 요청/에러 노이즈를 줄임)
  if (sending.value) return { error: undefined }
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck(event, payload)
    if (res.error) error.value = res.error
    return res
  } finally {
    sending.value = false
  }
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
  const { minBet, maxBet } = state.value.rules
  const prev = betAmount.value
  let next = Math.min(maxBet, prev + v)
  if (next < minBet) next = minBet
  if (next === prev) return // 이미 최대 베팅액
  sfx.chip()
  betAmount.value = next
  betChips.value = [...betChips.value, v]
}
function clearBet() {
  betAmount.value = 0
  betChips.value = []
}
async function confirmBet() {
  const res = await act('bet:place', { amount: betAmount.value })
  if (res.ok) {
    betAmount.value = 0
    betChips.value = []
  }
}
async function repeatLastBet() {
  if (!canRepeatLastBet.value || sending.value) return
  const { minBet, maxBet } = state.value.rules
  betAmount.value = Math.min(maxBet, Math.max(minBet, lastRoundBet.value))
  betChips.value = [betAmount.value]
  await confirmBet()
}
function doAction(move) {
  sfx.click()
  act('action', { move })
}
</script>

<template>
  <div v-if="state" class="pb-20">
  <div class="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1">
    <div class="mx-auto max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🃏 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs text-emerald-200">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-emerald-400">베팅 {{ state.rules.minBet.toLocaleString() }}~{{ state.rules.maxBet.toLocaleString() }}칩</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt"
      :total-seconds="state.phase === 'betting' ? state.rules.betSeconds : state.rules.turnSeconds" />

    <div class="relative"><FloatingText ref="floating" /></div>

    <!-- 테이블 펠트: 딜러 아치 + 좌석 반원 -->
    <div class="felt-table relative overflow-hidden rounded-[2rem] border-4 border-amber-600/40 p-3 shadow-2xl sm:p-5">
      <!-- 딜러 아치 영역 -->
      <section class="dealer-arc relative px-4 pb-5 pt-6 text-center">
        <!-- 슈(카드 뭉치) -->
        <div class="absolute right-3 top-2 flex flex-col items-center gap-1 opacity-90 sm:right-6" aria-hidden="true">
          <div class="shoe-graphic" />
          <span class="text-[8px] font-bold tracking-widest text-emerald-400/70">SHOE</span>
        </div>

        <svg viewBox="0 0 300 46" class="mx-auto h-9 w-full max-w-xs text-amber-400/85 sm:max-w-sm" aria-hidden="true">
          <path id="bjArcPath" d="M 15 42 Q 150 -6 285 42" fill="none" />
          <text font-size="13" font-weight="800" letter-spacing="1.5" fill="currentColor">
            <textPath href="#bjArcPath" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3:2</textPath>
          </text>
        </svg>
        <p class="mb-2 text-[9px] tracking-wide text-emerald-400/60">딜러는 17에서 반드시 멈춘다</p>

        <p class="mb-1 text-xs text-emerald-300">딜러 <b v-if="dealerView.total" class="text-amber-300">{{ dealerView.total }}</b></p>
        <div class="flex min-h-[64px] flex-wrap items-center justify-center gap-1.5 sm:min-h-[88px]">
          <CardImg v-for="(card, i) in dealerView.cards" :key="i" :code="card.code" />
          <p v-if="dealerView.cards.length === 0" class="text-sm text-emerald-500">대기 중</p>
        </div>
      </section>

      <!-- 좌석 반원(아치) -->
      <section class="bj-arc mt-5">
        <div v-for="(seat, i) in state.seats" :key="i" class="bj-seat">
          <div class="seat-card rounded-xl border p-2 text-center transition-colors"
            :class="[
              state.currentSeat === i ? 'seat-active fx-pulse-gold' : 'border-emerald-800 bg-emerald-900/40',
              seat && seat.userId === auth.user?.id ? 'seat-mine' : '',
              state.phase === 'result' && seat?.hands.some((h) => h.result && isWinOutcome(h.result.outcome)) ? 'fx-glow-win' : '',
            ]">
            <template v-if="seat">
              <p class="truncate text-xs font-bold" :class="seat.userId === auth.user?.id ? 'text-amber-300' : 'text-emerald-200'">
                {{ seat.nickname }}</p>
              <p v-if="seat.bet" class="flex items-center justify-center gap-1 text-xs text-emerald-400">
                <CasinoChip :value="seat.bet" :size="16" />{{ seat.bet.toLocaleString() }}칩</p>
              <div v-for="(hand, hi) in seat.hands" :key="hi" class="mt-1"
                :class="seat.activeHand === hi && state.currentSeat === i ? 'ring-1 ring-amber-400 rounded' : ''">
                <div class="flex flex-wrap justify-center gap-0.5">
                  <CardImg v-for="(card, ci) in seatCards(i, hi)" :key="ci" :code="card.code" class="!w-8 sm:!w-10" />
                </div>
                <p v-if="seatHandCaughtUp(i, hi)" class="text-xs text-emerald-300">
                  {{ hand.total }}<span v-if="hand.soft"> (소프트)</span></p>
                <p v-if="hand.result && seatHandCaughtUp(i, hi)" class="text-xs font-bold"
                  :class="isWinOutcome(hand.result.outcome) ? 'text-amber-300' : hand.result.outcome === 'push' ? 'text-emerald-300' : 'text-red-400'">
                  {{ OUTCOME_LABELS[hand.result.outcome] }}
                  <template v-if="isWinOutcome(hand.result.outcome)"> +{{ hand.result.payout.toLocaleString() }}</template>
                </p>
              </div>
              <button v-if="seat.userId === auth.user?.id" class="mt-1 text-xs text-red-400 hover:underline" @click="leaveSeat">
                떠나기</button>
            </template>
            <button v-else class="seat-empty w-full py-4 text-xs text-emerald-500 hover:text-amber-300" @click="sit(i)">
              + 앉기</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 조작 -->
    <section v-if="mySeat" class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div v-if="state.phase === 'betting' && mySeat.bet === 0" class="flex flex-col items-center gap-3">
        <ChipTray v-model="chipValue" :disabled="sending" />
        <button type="button" :disabled="sending"
          class="bet-spot flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-amber-500/50 text-center hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="눌러서 활성 칩을 베팅에 추가" @click="addChip(chipValue)">
          <span v-if="betChips.length === 0" class="px-1 text-[10px] leading-tight text-emerald-400">눌러서<br>베팅</span>
          <div v-else class="chip-stack">
            <CasinoChip v-for="(v, i) in betChips.slice(-6)" :key="i" :value="v" :size="26" class="chip-stack-item" />
          </div>
        </button>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <span class="font-bold tabular-nums text-amber-300">{{ betAmount.toLocaleString() }}칩</span>
          <button class="rounded-lg px-2 py-1 text-xs text-emerald-400 hover:text-red-400" @click="clearBet">지우기</button>
          <button v-if="canRepeatLastBet" :disabled="sending"
            class="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/10 disabled:opacity-30"
            :title="`직전 베팅 재현 (${lastRoundBet.toLocaleString()}칩)`" @click="repeatLastBet">↺ 직전 베팅</button>
          <button :disabled="betAmount === 0 || sending"
            class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
            @click="confirmBet">베팅 확정</button>
        </div>
      </div>
      <div v-else-if="isMyTurn && myHand" class="flex flex-wrap justify-center gap-2">
        <button :disabled="sending" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500 disabled:opacity-40" @click="doAction('hit')">히트</button>
        <button :disabled="sending" class="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold hover:bg-emerald-700 disabled:opacity-40" @click="doAction('stand')">스탠드</button>
        <button v-if="state.rules.doubleAllowed && myHand.cards.length === 2" :disabled="sending"
          class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold hover:bg-amber-500 disabled:opacity-40" @click="doAction('double')">더블</button>
        <button v-if="state.rules.splitAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2 && myHand.cards[0].code.slice(0, -1) === myHand.cards[1].code.slice(0, -1)"
          :disabled="sending" class="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold hover:bg-purple-500 disabled:opacity-40" @click="doAction('split')">스플릿</button>
        <button v-if="state.rules.surrenderAllowed && mySeat.hands.length === 1 && myHand.cards.length === 2"
          :disabled="sending" class="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold hover:bg-red-600 disabled:opacity-40" @click="doAction('surrender')">서렌더</button>
      </div>
      <p v-else class="text-center text-sm text-emerald-400">{{ PHASE_LABELS[state.phase] }}…</p>
      <p v-if="error" class="mt-2 text-center text-sm text-red-400">{{ error }}</p>
    </section>
    <p v-else class="text-center text-sm text-emerald-400">빈 좌석을 눌러 참가하세요.</p>
    </div>
    </div>

    <div class="lg:w-72 lg:shrink-0">
      <TableChat :game="game" />
    </div>
    </div>
    <WinCascade ref="cascade" />
    <TableHud :balance="auth.user?.balance ?? 0" :my-bet="myBet" :status-label="PHASE_LABELS[state.phase]" :limit-label="limitLabel" />
  </div>
</template>

<style scoped>
.chip-stack {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
}
.chip-stack-item {
  margin-top: -18px;
}
.chip-stack-item:last-child {
  margin-top: 0;
}

/* 펠트 테이블 배경 — 이미지 없이 그라디언트로 카지노 그린 펠트 질감을 낸다 */
.felt-table {
  background: radial-gradient(ellipse at 50% -8%, #0d5c3f 0%, #07422c 55%, #04241a 100%);
  box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.5), 0 10px 30px rgba(0, 0, 0, 0.45);
}

/* 딜러 아치 영역: 위쪽이 살짝 둥글게 말린 카지노 테이블 상단 곡선을 흉내낸다 */
.dealer-arc {
  border-radius: 50% 50% 12px 12px / 22% 22% 12px 12px;
  background: rgba(0, 0, 0, 0.16);
  border-bottom: 2px solid rgba(245, 158, 11, 0.25);
}

/* 슈(카드 딜링 슈) — 겹쳐진 카드 뭉치를 CSS만으로 표현 */
.shoe-graphic {
  width: 22px;
  height: 30px;
  border-radius: 3px;
  background: linear-gradient(160deg, #7f1d1d, #450a0a);
  border: 2px solid rgba(255, 255, 255, 0.75);
  box-shadow:
    -4px 4px 0 -1px rgba(127, 29, 29, 0.55),
    -8px 8px 0 -2px rgba(127, 29, 29, 0.35);
}

/* 좌석 반원(아치) 배치: 가장자리 좌석일수록 위로, 가운데 좌석일수록 아래(관전자 쪽)로 두어
   딜러를 향해 둘러앉은 곡선을 CSS만으로 흉내낸다. 트리그(삼각함수) 계산 없이 nth-child 오프셋으로 처리. */
.bj-arc {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
}
.bj-seat {
  flex: 0 0 auto;
  width: clamp(82px, 12vw, 112px);
}
.bj-seat:nth-child(1),
.bj-seat:nth-child(7) {
  margin-bottom: 2rem;
}
.bj-seat:nth-child(2),
.bj-seat:nth-child(6) {
  margin-bottom: 1.1rem;
}
.bj-seat:nth-child(3),
.bj-seat:nth-child(5) {
  margin-bottom: 0.3rem;
}
.bj-seat:nth-child(4) {
  margin-bottom: 0;
}
.seat-card {
  height: 100%;
}
.seat-active {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
.seat-mine {
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.75) inset;
}
.seat-empty {
  border-radius: 0.6rem;
  border: 1px dashed rgba(16, 185, 129, 0.35);
}

/* 모바일: 곡선 배치를 접고, 가로 스크롤 없는 2열 그리드로 전환 */
@media (max-width: 768px) {
  .bj-arc {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    padding-top: 0;
  }
  .bj-seat {
    width: auto;
    margin-bottom: 0 !important;
  }
}
</style>
