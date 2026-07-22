<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'
import FloatingText from '../components/FloatingText.vue'
import PhaseTimer from '../components/PhaseTimer.vue'
import TableChat from '../components/TableChat.vue'
import TableHud from '../components/TableHud.vue'
import ChipTray from '../components/ChipTray.vue'
import ChipStack from '../components/ChipStack.vue'
import BetControls from '../components/BetControls.vue'
import WinCascade from '../components/WinCascade.vue'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'
import { chipStyleFor } from '../lib/chips'
import { cardRankSuit } from '../lib/cardText'
import { nearDeadline, DEADLINE_GUARD_MESSAGE } from '../lib/betGuard'

// PixiJS(WebGL) 렌더러 — 그래픽 모드를 켠 유저만 번들을 내려받도록 async import.
const BlackjackPixi = defineAsyncComponent(() => import('../pixi/BlackjackPixi.vue'))

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('blackjack')

const state = ref(null)
const error = ref('')
const sending = ref(false)
const chipValue = ref(100) // 활성 칩(현재 선택된 베팅 단위)
// 그래픽(Pixi) 모드: ?pixi=1 또는 저장된 설정으로 켠다. DOM 렌더러와 병행하는 표현 계층 전환.
const usePixi = ref(route.query.pixi === '1' || localStorage.getItem('pixi') === '1')
const floating = ref(null)
const cascade = ref(null)

const mySeatIdx = computed(() => state.value?.seats.findIndex((s) => s?.userId === auth.user?.id) ?? -1)
const mySeat = computed(() => (mySeatIdx.value >= 0 ? state.value.seats[mySeatIdx.value] : null))
const isMyTurn = computed(() => state.value?.phase === 'acting' && state.value.currentSeat === mySeatIdx.value)
// 라운드 사이(대기/베팅)이고 딜러 카드가 아직 없으면 슈에서 셔플 중 — 슈 그래픽이 직접 리플 셔플한다.
const isShuffling = computed(() =>
  !dealerView.value.cards.length && ['betting', 'waiting'].includes(state.value?.phase))
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

// 카드 한 장의 텍스트 표기용 클래스(빨강 수트만 색을 다르게)
function suitClass(code) {
  return cardRankSuit(code).isRed ? 'text-red-400' : 'text-slate-100'
}
function cardText(code) {
  // 숨김 카드는 '?' — 유니코드 카드뒷면 글리프(🂠)는 Windows 폰트에 없어 깨져 보인다
  const { rank, symbol, hidden } = cardRankSuit(code)
  return hidden ? '?' : `${rank}${symbol}`
}

// 그래픽 모드 전환. Pixi 모드에서는 씬이 자체 reveal 큐를 돌리므로 DOM 표시 계층을 정지하고,
// DOM 복귀 시엔 현재 스냅샷으로 즉시 재동기화한다(카드 사운드 이중 재생 방지).
function togglePixi() {
  usePixi.value = !usePixi.value
  try {
    localStorage.setItem('pixi', usePixi.value ? '1' : '0')
  } catch {
    // 저장 실패는 무시(사생활 모드 등)
  }
  if (usePixi.value) {
    if (revealTimer) {
      clearTimeout(revealTimer)
      revealTimer = null
    }
    revealQueue = []
  } else if (state.value) {
    seedDisplay(state.value)
  }
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
    if (!usePixi.value) seedDisplay(state.value)
  } catch {
    return
  }
  game.onState((s) => {
    // 진행 레이어를 최신 스냅샷에 수렴시킨다(항상 state.value=이전 스냅샷 기준으로 diff).
    // Pixi 모드에서는 씬이 동일한 큐 로직을 수행하므로 DOM 표시 계층은 건너뛴다.
    if (!usePixi.value) {
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
      sfx.shuffle() // 셔플 연출(빈 딜러 영역의 리플 애니메이션)과 함께 촤라라락

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
// 이미 서버에 얹혀 있는 내 베팅액(권위 있는 값)과, 여기에 더 얹을 수 있는 여유분.
// 여유분 = (테이블 최대 베팅 - 현재 내 베팅)과 잔고 중 작은 값.
const myBetPlaced = computed(() => mySeat.value?.bet ?? 0)
const remainingCap = computed(() =>
  Math.max(0, Math.min((state.value?.rules.maxBet ?? 0) - myBetPlaced.value, auth.user?.balance ?? 0)))
const canBetMax = computed(() => state.value?.phase === 'betting' && remainingCap.value > 0)

// 즉시 누적 베팅: 칩을 얹을 때마다 서버에 바로 반영한다. 확정 버튼이 없고, 베팅 시간이 끝나면
// 그 시점에 얹혀 있는 칩(seat.bet)으로 서버가 자동으로 라운드를 시작한다(closeBetting).
// 룰렛/바카라와 동일한 즉시 베팅 모델 — 확정 타이밍 경합이나 백그라운드 탭 문제가 없다.
async function sendBet(amount) {
  if (sending.value) return { error: undefined }
  // 마감 직전 보호: 서버 도착 시점 레이스로 조용히 거부/의도치 않은 접수가 되는 것을 예방
  if (nearDeadline(state.value)) {
    error.value = DEADLINE_GUARD_MESSAGE
    return { error: error.value }
  }
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck('bet:place', { amount })
    if (res.error) error.value = res.error
    return res
  } finally {
    sending.value = false
  }
}
async function addChip() {
  if (state.value?.phase !== 'betting') return
  const cap = remainingCap.value
  if (cap <= 0) {
    error.value = '더 얹을 수 없습니다 (테이블 한도 또는 잔고 초과).'
    return
  }
  const amount = Math.min(chipValue.value, cap)
  const before = myBetPlaced.value
  const res = await sendBet(amount)
  if (res?.ok) {
    sfx.chip()
    // 누적 베팅액이 상위 액면으로 자동 병합되는 경계를 넘으면 겹클링을 더한다.
    if (chipStyleFor(before) !== chipStyleFor(before + amount)) sfx.chipStack()
  }
}
// '최대' — 여유분 전부를 한 번에 얹는다.
async function betMax() {
  if (state.value?.phase !== 'betting' || remainingCap.value <= 0) return
  const res = await sendBet(remainingCap.value)
  if (res?.ok) sfx.chipStack()
}
// 마지막으로 얹은 칩 1개만 되돌린다(서버가 즉시 환불).
async function undoChip() {
  if (state.value?.phase !== 'betting' || myBetPlaced.value === 0 || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck('bet:undo')
    if (res.error) error.value = res.error
    else sfx.chip()
  } finally {
    sending.value = false
  }
}
// 내 베팅 전체 취소(서버가 총액 환불).
async function clearBet() {
  if (state.value?.phase !== 'betting' || myBetPlaced.value === 0 || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck('bet:clear')
    if (res.error) error.value = res.error
    else sfx.chipStack()
  } finally {
    sending.value = false
  }
}
async function repeatLastBet() {
  if (!canRepeatLastBet.value || sending.value) return
  const { minBet, maxBet } = state.value.rules
  const amount = Math.min(maxBet, Math.max(minBet, lastRoundBet.value))
  const res = await sendBet(amount)
  if (res?.ok) sfx.chipStack()
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
      <button class="rounded-full border border-amber-500/40 px-2.5 py-0.5 text-xs font-bold text-amber-300 hover:bg-amber-500/10"
        :title="usePixi ? '기존 화면으로 전환' : 'PixiJS(WebGL) 렌더링으로 전환'" @click="togglePixi">
        {{ usePixi ? '🖼 기본 화면' : '✨ 그래픽 화면(베타)' }}</button>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt"
      :total-seconds="state.phase === 'betting' ? state.rules.betSeconds : state.rules.turnSeconds" />

    <div class="relative"><FloatingText ref="floating" /></div>

    <!-- 그래픽(Pixi) 모드: 캔버스가 펠트/카드/칩을 그리고, 보조 텍스트·버튼은 DOM이 담당 -->
    <div v-if="usePixi" class="space-y-2">
      <div class="pixi-bj-frame game-surface relative overflow-hidden rounded-[2rem] border-4 border-amber-600/40 shadow-2xl">
        <BlackjackPixi :get-state="() => state" :subscribe="game.onState" :my-user-id="auth.user?.id" :on-sit="sit" />
      </div>
      <!-- 접근성/보조 표기: 캔버스와 동일한 서버 데이터의 문자 표기(스크린리더·그래픽 미표시 대비) -->
      <p v-if="state.dealer.cards.length" class="text-center font-mono text-sm tracking-wide" aria-live="polite">
        <span class="text-emerald-300">딜러</span>
        <span v-for="(card, i) in state.dealer.cards" :key="'pd' + i" class="ml-1 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
        <b v-if="state.dealer.total" class="ml-1 text-amber-300">= {{ state.dealer.total }}</b>
      </p>
      <p v-if="mySeat && mySeat.hands.length" class="text-center font-mono text-sm" aria-live="polite">
        <span class="text-emerald-300">내 손패</span>
        <template v-for="(hand, hi) in mySeat.hands" :key="'ph' + hi">
          <span v-for="(card, ci) in hand.cards" :key="'phc' + hi + '-' + ci" class="ml-1 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
          <b class="ml-1 text-amber-300">{{ hand.total }}</b>
        </template>
      </p>
      <p v-if="mySeat && !mySeat.bet" class="text-center">
        <button class="text-xs text-red-400 hover:underline" @click="leaveSeat">자리 뜨기</button>
      </p>
    </div>

    <!-- 테이블 펠트: 딜러 아치 + 좌석 반원 (기본 DOM 렌더러) -->
    <div v-else class="felt-table game-surface relative overflow-hidden rounded-[2rem] border-4 border-amber-600/40 p-3 shadow-2xl sm:p-5">
      <!-- 딜러 아치 영역 -->
      <section class="dealer-arc relative px-4 pb-5 pt-6 text-center">
        <!-- 슈(카드 딜링 슈): 라운드 사이엔 이 슈 자체에서 카드가 촤라라락 리플 셔플된다.
             셔플 효과와 슈가 따로 떠 있지 않고, 실제 슈에서 섞여 딜된다. -->
        <div class="shoe-zone absolute right-2 top-1 flex flex-col items-center gap-1 sm:right-5" aria-hidden="true">
          <div class="shoe-graphic" :class="{ 'shoe-shuffling': isShuffling }">
            <template v-if="isShuffling">
              <span v-for="i in 5" :key="i" class="shoe-riffle-card" :style="{ '--si': i - 1 }" />
            </template>
          </div>
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
        <div class="flex min-h-[64px] items-start justify-center sm:min-h-[88px]">
          <!-- 떠나는 쪽이 슈 방향으로 날아간 뒤 다음 상태가 나타난다:
               셔플이 끝나면 셔플 덱이 슈로 돌아가고, 라운드가 끝나면 쓴 카드들이 슈(디스카드) 쪽으로 회수된다 -->
          <Transition name="to-shoe" mode="out-in">
            <div v-if="dealerView.cards.length" key="cards" class="card-cascade cascade-dealer" :style="{ '--n': dealerView.cards.length }">
              <span v-for="(card, i) in dealerView.cards" :key="i" class="cascade-slot" :style="{ '--i': i }">
                <CardImg :code="card.code" deal-animate class="!w-14 sm:!w-20" />
              </span>
            </div>
            <!-- 카드는 우상단 실제 슈에서 섞이므로, 중앙엔 상태 문구만 둔다 -->
            <p v-else key="wait" class="self-center text-sm text-emerald-500">
              {{ isShuffling ? '🔀 슈에서 카드를 섞는 중…' : '대기 중' }}</p>
          </Transition>
        </div>
        <!-- 딜러 카드 텍스트 표기: 그래픽이 잘 안 보일 때를 대비한 보조 표기(같은 서버 데이터에서 파생).
             빈 상태에도 같은 높이를 차지해 아래 좌석 영역이 위아래로 튀지 않는다. -->
        <p class="mt-1 min-h-[20px] font-mono text-sm tracking-wide">
          <template v-if="dealerView.cards.length">
            <span v-for="(card, i) in dealerView.cards" :key="'dt' + i" class="mr-1 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
            <span v-if="dealerView.total" class="ml-1 font-bold text-amber-300">= {{ dealerView.total }}</span>
          </template>
        </p>
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
              <div v-if="seat.bet" class="flex flex-col items-center gap-0.5">
                <ChipStack :amount="seat.bet" :size="22" :max-chips="4" :show-label="false" />
                <span class="text-xs text-emerald-400">{{ seat.bet.toLocaleString() }}칩</span>
              </div>
              <div v-for="(hand, hi) in seat.hands" :key="hi" class="mt-1"
                :class="seat.activeHand === hi && state.currentSeat === i ? 'ring-1 ring-amber-400 rounded' : ''">
                <div class="card-cascade" :class="seat.userId === auth.user?.id ? 'cascade-mine' : 'cascade-other'"
                  :style="{ '--n': seatCards(i, hi).length }">
                  <span v-for="(card, ci) in seatCards(i, hi)" :key="ci" class="cascade-slot" :style="{ '--i': ci }">
                    <CardImg :code="card.code" deal-animate
                      :class="seat.userId === auth.user?.id ? '!w-11 sm:!w-16' : '!w-8 sm:!w-10'" />
                  </span>
                </div>
                <!-- 카드 텍스트 표기: 내 손패는 물론 모든 좌석에 함께 표기(그래픽이 안 보일 때 대비) -->
                <p v-if="seatCards(i, hi).length" class="font-mono tracking-wide"
                  :class="seat.userId === auth.user?.id ? 'text-sm' : 'text-xs'">
                  <span v-for="(card, ci) in seatCards(i, hi)" :key="'st' + ci" class="mr-0.5 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
                </p>
                <p v-if="seatHandCaughtUp(i, hi)" class="text-xs text-emerald-300">
                  {{ hand.total }}<span v-if="hand.soft"> (소프트)</span></p>
                <p v-if="hand.result && seatHandCaughtUp(i, hi)" class="text-xs font-bold"
                  :class="isWinOutcome(hand.result.outcome) ? 'text-amber-300' : hand.result.outcome === 'push' ? 'text-emerald-300' : 'text-red-400'">
                  {{ OUTCOME_LABELS[hand.result.outcome] }}
                  <template v-if="isWinOutcome(hand.result.outcome)"> +{{ hand.result.payout.toLocaleString() }}</template>
                </p>
              </div>
              <!-- 칩을 올려 라운드에 참여하면 떠날 수 없다(자동확정 모델). 베팅 전에만 이탈 가능. -->
              <button v-if="seat.userId === auth.user?.id && !seat.bet" class="mt-1 text-xs text-red-400 hover:underline" @click="leaveSeat">
                떠나기</button>
              <span v-else-if="seat.userId === auth.user?.id" class="mt-1 block text-[10px] text-emerald-500/70">🔒 라운드 참여 중</span>
            </template>
            <button v-else class="seat-empty w-full py-4 text-xs text-emerald-500 hover:text-amber-300" @click="sit(i)">
              + 앉기</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 조작: 베팅 UI↔액션 버튼이 바뀌어도 섹션 높이가 변하지 않도록 고정(내용은 세로 중앙) -->
    <section v-if="mySeat" class="game-surface flex min-h-[248px] flex-col justify-center rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div v-if="state.phase === 'betting'" class="flex flex-col items-center gap-3">
        <ChipTray v-model="chipValue" :disabled="sending" />
        <button type="button" :disabled="sending || (remainingCap === 0 && myBetPlaced === 0)"
          class="bet-spot flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-amber-500/50 text-center hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="눌러서 활성 칩을 베팅에 올려놓기" @click="addChip">
          <span v-if="myBetPlaced === 0" class="px-1 text-[10px] leading-tight text-emerald-400">눌러서<br>베팅</span>
          <ChipStack v-else :amount="myBetPlaced" :size="34" :max-chips="6" :show-label="false" />
        </button>
        <span class="font-bold tabular-nums text-amber-300">{{ myBetPlaced.toLocaleString() }}칩</span>
        <BetControls :sending="sending" :can-max="canBetMax"
          :max-label="`여유분 전부 베팅 (+${remainingCap.toLocaleString()}칩)`"
          :can-undo="myBetPlaced > 0" :can-clear="myBetPlaced > 0"
          :can-repeat="canRepeatLastBet" :repeat-label="`직전 베팅 재현 (${lastRoundBet.toLocaleString()}칩)`"
          @max="betMax" @undo="undoChip" @clear="clearBet" @repeat="repeatLastBet" />
        <p class="text-center text-[11px] leading-snug text-emerald-400/70">
          🕒 시간이 끝나면 <b class="text-amber-300">올려둔 칩으로 자동 시작</b>됩니다 —
          베팅하지 않으면 <b class="text-red-300">자리가 비워져요</b>.</p>
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
      <!-- 에러 슬롯: 항상 같은 높이를 차지해 에러 표시/해제 시에도 흔들리지 않는다 -->
      <p class="mt-2 min-h-[20px] text-center text-sm text-red-400">{{ error }}</p>
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
/* 카드 캐스케이드: 전문 딜러가 놓듯 회전 없이 오른쪽 아래로 일정한 계단식 겹침.
   각 카드 위치는 자신의 인덱스(--i)에만 의존하므로 새 카드가 와도 기존 카드는 움직이지 않는다.
   --card-w는 CardImg에 주는 테일윈드 폭(!w-*)과 반드시 일치해야 겹침 폭이 정확하다. */
.card-cascade {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-bottom: calc((var(--n, 1) - 1) * var(--dy));
}
.cascade-slot {
  position: relative;
  z-index: var(--i, 0);
  transform: translateY(calc(var(--i, 0) * var(--dy)));
}
.cascade-slot + .cascade-slot {
  margin-left: calc(var(--reveal) - var(--card-w));
}
/* 겹친 카드의 왼쪽 경계가 또렷이 읽히도록 위에 얹힌 카드에만 경계 그림자 */
.cascade-slot + .cascade-slot :deep(.card-face) {
  box-shadow: -3px 2px 6px rgba(0, 0, 0, 0.45);
}
/* 딜러는 실제 딜러처럼 겹침 없이 옆으로 나란히: --reveal을 카드 폭보다 크게 주면 그 차이가 간격이 된다.
   플레이어 핸드는 겹침(--reveal < --card-w)은 유지하되 아래로 내려가지 않고(--dy: 0) 옆으로만 쌓인다. */
.cascade-dealer { --card-w: 56px; --reveal: 60px; --dy: 0px; }
.cascade-mine { --card-w: 44px; --reveal: 18px; --dy: 0px; }
.cascade-other { --card-w: 32px; --reveal: 13px; --dy: 0px; }
@media (min-width: 640px) {
  .cascade-dealer { --card-w: 80px; --reveal: 86px; --dy: 0px; }
  .cascade-mine { --card-w: 64px; --reveal: 25px; --dy: 0px; }
  .cascade-other { --card-w: 40px; --reveal: 15px; --dy: 0px; }
}
/* 나란히 놓인 딜러 카드에는 겹침 경계 그림자가 필요 없다 */
.cascade-dealer .cascade-slot + .cascade-slot :deep(.card-face) {
  box-shadow: none;
}

/* 그래픽(Pixi) 모드 캔버스 프레임 — 좌석 아치까지 담기는 고정 높이 */
.pixi-bj-frame {
  height: clamp(420px, 58vh, 560px);
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

/* 슈(카드 딜링 슈) — 겹쳐진 카드 뭉치. 셔플 중엔 이 슈 자체에서 카드가 리플되어 나온다.
   셔플 효과와 슈가 따로 떠 있지 않고, 실제 슈에서 섞여 딜된다. */
.shoe-graphic {
  position: relative;
  width: 26px;
  height: 34px;
  border-radius: 3px;
  background: linear-gradient(160deg, #7f1d1d, #450a0a);
  border: 2px solid rgba(255, 255, 255, 0.75);
  box-shadow:
    -4px 4px 0 -1px rgba(127, 29, 29, 0.55),
    -8px 8px 0 -2px rgba(127, 29, 29, 0.35);
}
.shoe-graphic.shoe-shuffling {
  animation: shoe-jiggle 0.28s ease-in-out infinite;
}
@keyframes shoe-jiggle {
  0%, 100% { transform: translateX(0) rotate(0); }
  50% { transform: translateX(-1.5px) rotate(-2deg); }
}
/* 슈에서 카드가 촤라라락 리플: 카드 뒷면이 슈(0,0)를 기준으로 위-왼쪽으로 아치를 그리며
   튀어나왔다 되돌아가는 무한 루프. --si 스태거로 연속 리듬을 만든다. */
.shoe-riffle-card {
  position: absolute;
  left: 0;
  top: 0;
  width: 22px;
  height: 30px;
  border-radius: 3px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 4px, transparent 4px 8px),
    linear-gradient(160deg, #7f1d1d, #450a0a);
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  transform-origin: bottom center;
  animation: shoe-riffle 1.05s cubic-bezier(0.45, 0.05, 0.35, 1) infinite;
  animation-delay: calc(var(--si) * -0.2s);
}
@keyframes shoe-riffle {
  0% { transform: translate(0, 0) rotate(0) scale(0.9); opacity: 0; }
  18% { opacity: 1; }
  50% { transform: translate(-20px, -18px) rotate(-16deg) scale(1); opacity: 1; }
  82% { opacity: 1; }
  100% { transform: translate(0, 0) rotate(0) scale(0.9); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .shoe-graphic.shoe-shuffling { animation: none; }
  .shoe-riffle-card { animation: none; opacity: 0; }
}

/* 슈 왕복 연출: 딜러 영역 중앙과 우상단 슈 사이를 오간다.
   - 떠날 때(셔플 종료→딜 시작, 라운드 종료→카드 회수): 슈 쪽으로 날아가며 축소
   - 들어올 때(셔플 시작): 같은 궤적을 역재생해 슈에서 덱을 꺼내오는 느낌을 준다
   딜러 카드(card-cascade)의 진입은 카드별 fx-shoe-travel이 이미 담당하므로 제외한다. */
.to-shoe-leave-active {
  animation: fx-to-shoe 0.45s cubic-bezier(0.4, 0, 0.8, 0.4) both;
}
.to-shoe-enter-active:not(.card-cascade) {
  animation: fx-to-shoe 0.4s cubic-bezier(0.2, 0.6, 0.4, 1) both reverse;
}
@keyframes fx-to-shoe {
  to {
    transform: translate(clamp(140px, 24vw, 330px), -74px) scale(0.35) rotate(8deg);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .to-shoe-leave-active,
  .to-shoe-enter-active:not(.card-cascade) { animation: none; }
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
/* 좌석 카드 높이 고정: 착석/베팅/카드/결과가 생겨도 좌석 크기가 변하지 않는다(레이아웃 안정).
   내용은 위에서부터 채우고, 빈 좌석 버튼은 세로 중앙에 둔다. */
.bj-seat .seat-card {
  min-height: 168px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}
.bj-seat .seat-card > * {
  width: 100%;
}
.bj-seat .seat-empty {
  margin: auto 0;
}
@media (min-width: 640px) {
  .bj-seat .seat-card {
    min-height: 204px;
  }
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
