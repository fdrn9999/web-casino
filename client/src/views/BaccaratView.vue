<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardImg from '../components/CardImg.vue'

// PixiJS(WebGL) 렌더러 — 그래픽 모드를 켠 유저만 번들을 내려받도록 async import.
const BaccaratPixi = defineAsyncComponent(() => import('../pixi/BaccaratPixi.vue'))
import BaccaratRoads from '../components/BaccaratRoads.vue'
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
// 그래픽(Pixi) 모드 — 전 게임 공통 토글(localStorage 'pixi')
const usePixi = ref(route.query.pixi === '1' || localStorage.getItem('pixi') === '1')
function togglePixi() {
  usePixi.value = !usePixi.value
  try {
    localStorage.setItem('pixi', usePixi.value ? '1' : '0')
  } catch {
    // 저장 실패는 무시(사생활 모드 등)
  }
}

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

// ─────────────────────────────────────────────────────────────────────────
// 한 장씩 순차 공개 레이어(progressive reveal, 블랙잭 화면과 동일한 패턴).
// 서버는 revealing 진입 시 결과(양쪽 카드 전부)를 한번에 보내지만, 여기서는
// "화면에 이미 보여준" 카드만 담는 지연(lag) 미러를 따로 두고, 실제 카지노
// 순서(플레이어1-뱅커1-플레이어2-뱅커2-플레이어3-뱅커3)로 한 장씩 슈에서 날아와
// 뒤집히도록 스태거링한다. 결과/정산은 절대 이 레이어에서 파생되지 않으며,
// 서버가 보낸 카드 이외에는 어떤 것도 화면에 그리지 않는다.
// ─────────────────────────────────────────────────────────────────────────
const revealedPlayer = ref([]) // Array<{code}> — 지금까지 공개된 플레이어 카드
const revealedBanker = ref([]) // Array<{code}> — 지금까지 공개된 뱅커 카드
let revealQueue = []
let revealTimer = null
let flipTimer = null
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const playerCaughtUp = computed(() => revealedPlayer.value.length === (state.value?.result?.player.length ?? -1))
const bankerCaughtUp = computed(() => revealedBanker.value.length === (state.value?.result?.banker.length ?? -1))

function clearRevealTimers() {
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
  if (flipTimer) {
    clearTimeout(flipTimer)
    flipTimer = null
  }
}

function resetReveal() {
  revealedPlayer.value = []
  revealedBanker.value = []
  revealQueue = []
  clearRevealTimers()
}

// 이미 진행 중인 라운드에 접속한 경우(reveal/result 단계) — 지금까지의 결과는
// 애니메이션 없이 즉시 스냅한다(내가 안 본 과거를 가짜로 "딜"하지 않는다).
function seedReveal(result) {
  revealedPlayer.value = result ? result.player.map((c) => ({ ...c })) : []
  revealedBanker.value = result ? result.banker.map((c) => ({ ...c })) : []
  revealQueue = []
  clearRevealTimers()
}

function buildRevealSteps(result) {
  // 실제 바카라 딜 순서: 플레이어1 - 뱅커1 - 플레이어2 - 뱅커2 - (플레이어3) - (뱅커3)
  const steps = []
  for (let i = 0; i < 3; i++) {
    if (result.player[i]) steps.push({ side: 'player', card: result.player[i] })
    if (result.banker[i]) steps.push({ side: 'banker', card: result.banker[i] })
  }
  return steps
}

// revealSeconds 창(서버가 result-phase로 넘어가기 전까지 준 시간) 안에 전체 공개가
// 여유 있게 끝나도록 카드 수에 맞춰 간격을 300~500ms 범위에서 스케일한다.
function computeStagger(cardCount, revealSeconds) {
  const totalMs = (revealSeconds ?? 4) * 1000
  const tailMs = 700 // 마지막 카드의 슈이동+플립이 끝나고 잠시 보여질 여유 시간
  const budget = Math.max(400, totalMs - tailMs)
  const gaps = Math.max(1, cardCount - 1)
  return Math.min(500, Math.max(150, budget / gaps))
}

function applyStep(step) {
  const target = step.side === 'player' ? revealedPlayer : revealedBanker
  target.value = [...target.value, step.card]
  sfx.cardDeal()
  if (!prefersReduced) {
    flipTimer = setTimeout(() => sfx.cardFlip(), 260)
  }
}

function tickQueue(stagger) {
  revealTimer = null
  if (revealQueue.length === 0) return
  const step = revealQueue.shift()
  applyStep(step)
  revealTimer = setTimeout(() => tickQueue(stagger), stagger)
}

function startReveal(result, revealSeconds) {
  resetReveal()
  const steps = buildRevealSteps(result)
  if (prefersReduced) {
    steps.forEach(applyStep)
    return
  }
  revealQueue = steps
  tickQueue(computeStagger(steps.length, revealSeconds))
}

// 카드 텍스트 표기용(블랙잭 화면과 동일한 헬퍼 — 같은 서버 카드 데이터에서 파생되므로 항상 그래픽과 일치)
function suitClass(code) {
  return cardRankSuit(code).isRed ? 'text-red-300' : 'text-slate-100'
}
function cardText(code) {
  // 숨김 카드는 '?' — 유니코드 카드뒷면 글리프(🂠)는 Windows 폰트에 없어 깨져 보인다
  const { rank, symbol, hidden } = cardRankSuit(code)
  return hidden ? '?' : `${rank}${symbol}`
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  // 접속 시점에 이미 reveal/result 단계로 라운드가 진행 중이면, 여태까지의 결과를 즉시 스냅한다.
  if ((state.value.phase === 'revealing' || state.value.phase === 'result') && state.value.result) {
    seedReveal(state.value.result)
  }
  game.onState((s) => {
    if (s.phase === 'revealing' && state.value?.phase !== 'revealing' && s.result) {
      startReveal(s.result, s.rules?.revealSeconds)
    } else if (!s.result) {
      resetReveal()
    }
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
onUnmounted(() => {
  game.disconnect()
  clearRevealTimers()
  revealQueue = []
})

const lastKind = ref(null) // 마지막으로 베팅한 곳 — '최대(올인)' 대상
// 최대 가능 여부: 마지막 베팅 대상에 여유분(테이블 한도·잔고 중 작은 값)이 남아 있으면 활성.
const canBetMaxBac = computed(() => {
  if (state.value?.phase !== 'betting' || !lastKind.value) return false
  const cap = Math.min((state.value.rules.maxBet ?? 0) - (myBetByKind.value[lastKind.value] ?? 0), auth.user?.balance ?? 0)
  return cap > 0
})

async function bet(kind, amountOverride) {
  // 라운드트립 중 중복 클릭 방지(요청이 아직 진행 중일 때만 막음).
  if (sending.value) return
  // 마감 직전 보호: 도착 시점 레이스로 조용히 거부/의도치 않은 접수가 되는 것을 예방
  if (nearDeadline(state.value)) {
    error.value = DEADLINE_GUARD_MESSAGE
    return
  }
  const { minBet, maxBet } = state.value.rules
  const balance = auth.user?.balance ?? 0
  const prevTotal = myBetByKind.value[kind] ?? 0
  // 칩을 잔고·테이블 한도로 자동 클램프 — 큰 칩을 눌러도 여유분까지만 베팅(올인 편의, 전 게임 공통).
  const cap = Math.min(maxBet - prevTotal, balance)
  let amt = Math.min(amountOverride ?? chipValue.value, cap)
  if (amt <= 0) {
    error.value = '더 얹을 수 없습니다 (테이블 한도 또는 잔고 초과).'
    return
  }
  // 최초 베팅은 minBet 이상이어야 한다 — 여유가 있으면 minBet까지 끌어올린다.
  if (prevTotal === 0 && amt < minBet) {
    if (cap >= minBet) amt = minBet
    else { error.value = `최소 베팅(${minBet.toLocaleString()}칩)에 미치지 못합니다.`; return }
  }
  sending.value = true
  error.value = ''
  sfx.chip()
  if (chipStyleFor(prevTotal) !== chipStyleFor(prevTotal + amt)) sfx.chipStack()
  try {
    const res = await game.emitAck('bet:place', { kind, amount: amt })
    if (res.error) {
      error.value = res.error
    } else {
      roundBets.value = [...roundBets.value, { kind, amount: amt }]
      lastKind.value = kind
    }
  } finally {
    sending.value = false
  }
}

// 최대(올인): 마지막으로 베팅한 곳에 여유분 전부를 얹는다(전 게임 공통 편의).
async function betMaxKind() {
  if (state.value?.phase !== 'betting' || sending.value) return
  const kind = lastKind.value
  if (!kind) {
    error.value = '먼저 베팅할 곳을 누르세요.'
    return
  }
  const cap = Math.min((state.value.rules.maxBet ?? 0) - (myBetByKind.value[kind] ?? 0), auth.user?.balance ?? 0)
  if (cap <= 0) {
    error.value = '더 얹을 수 없습니다.'
    return
  }
  await bet(kind, cap)
}

async function repeatLastBet() {
  if (!canRepeatLastBet.value || sending.value) return
  for (const b of lastRoundBets.value) {
    // eslint-disable-next-line no-await-in-loop
    await bet(b.kind, b.amount)
    if (error.value) break
  }
}

// 마지막 베팅 1건 되돌리기 — 서버가 배치 단위 로그에서 물리고 즉시 환불한다
async function undoLastBet() {
  if (state.value?.phase !== 'betting' || sending.value || myBetTotal.value === 0) return
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck('bet:undo')
    if (res.error) {
      error.value = res.error
    } else {
      roundBets.value = roundBets.value.slice(0, -1)
      sfx.chip()
    }
  } finally {
    sending.value = false
  }
}

// 이번 라운드 내 베팅 전체 취소 — 총액 즉시 환불
async function clearMyBets() {
  if (state.value?.phase !== 'betting' || sending.value || myBetTotal.value === 0) return
  sending.value = true
  error.value = ''
  try {
    const res = await game.emitAck('bet:clear')
    if (res.error) {
      error.value = res.error
    } else {
      roundBets.value = []
      sfx.chipStack()
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div v-if="state" class="pb-20">
  <div class="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1">
    <div class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🀄 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-amber-500/80">바카라 · 뱅커 0.95:1</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="rounded-full border border-amber-500/40 px-2.5 py-0.5 text-xs font-bold text-amber-300 hover:bg-amber-500/10"
        :title="usePixi ? '기존 화면으로 전환' : 'PixiJS(WebGL) 렌더링으로 전환'" @click="togglePixi">
        {{ usePixi ? '🖼 기본 화면' : '✨ 그래픽 화면(베타)' }}</button>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 카드 -->
    <div class="relative"><FloatingText ref="floating" /></div>

    <!-- 그래픽(Pixi) 모드: 캔버스가 펠트/카드/승자 표시를 그린다. 텍스트 병기는 아래 공통 유지 -->
    <section v-if="usePixi" class="pixi-bac-frame game-surface relative overflow-hidden rounded-2xl border border-emerald-800 shadow-2xl">
      <BaccaratPixi :get-state="() => state" :subscribe="game.onState"
        :get-player-cards="() => revealedPlayer" :get-banker-cards="() => revealedBanker" />
    </section>
    <!-- 접근성/보조 표기(픽시 모드): 공개된 만큼만 문자로 병기 -->
    <p v-if="usePixi && (revealedPlayer.length || revealedBanker.length)" class="text-center font-mono text-xs tracking-wide" aria-live="polite">
      <span class="text-sky-300">플레이어</span>
      <span v-for="(card, i) in revealedPlayer" :key="'ppt' + i" class="ml-0.5 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
      <b v-if="playerCaughtUp && state.result" class="ml-1 text-sky-200">= {{ state.result.playerTotal }}</b>
      <span class="mx-2 text-emerald-600">|</span>
      <span class="text-red-300">뱅커</span>
      <span v-for="(card, i) in revealedBanker" :key="'pbt' + i" class="ml-0.5 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
      <b v-if="bankerCaughtUp && state.result" class="ml-1 text-red-200">= {{ state.result.bankerTotal }}</b>
    </p>

    <section v-if="!usePixi" class="grid grid-cols-2 gap-3">
      <div class="rounded-2xl border border-sky-500/30 bg-emerald-900/50 p-4 text-center"
        :class="state.phase === 'result' && state.result?.outcome === 'player' ? 'fx-glow-win' : ''">
        <p class="text-xs font-bold text-sky-300">플레이어
          <b v-if="playerCaughtUp && state.result" class="text-lg">{{ state.result.playerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in revealedPlayer" :key="i" :code="card.code" deal-animate />
        </div>
        <!-- 카드 텍스트 표기: 그래픽과 동일한 서버 데이터에서 파생, 공개된 카드만큼만 노출 -->
        <p v-if="revealedPlayer.length" class="mt-1 font-mono text-xs tracking-wide"
          :class="state.phase === 'result' && state.result?.outcome === 'player' ? 'text-amber-300 font-bold' : 'text-sky-200'">
          플레이어: <span v-for="(card, i) in revealedPlayer" :key="'pt' + i" class="mr-0.5 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
          <span v-if="playerCaughtUp && state.result">= {{ state.result.playerTotal }}</span>
        </p>
      </div>
      <div class="rounded-2xl border border-red-500/30 bg-emerald-900/50 p-4 text-center"
        :class="state.phase === 'result' && state.result?.outcome === 'banker' ? 'fx-glow-win' : ''">
        <p class="text-xs font-bold text-red-300">뱅커
          <b v-if="bankerCaughtUp && state.result" class="text-lg">{{ state.result.bankerTotal }}</b></p>
        <div class="mt-2 flex min-h-16 justify-center gap-1">
          <CardImg v-for="(card, i) in revealedBanker" :key="i" :code="card.code" deal-animate />
        </div>
        <p v-if="revealedBanker.length" class="mt-1 font-mono text-xs tracking-wide"
          :class="state.phase === 'result' && state.result?.outcome === 'banker' ? 'text-amber-300 font-bold' : 'text-red-200'">
          뱅커: <span v-for="(card, i) in revealedBanker" :key="'bt' + i" class="mr-0.5 font-bold" :class="suitClass(card.code)">{{ cardText(card.code) }}</span>
          <span v-if="bankerCaughtUp && state.result">= {{ state.result.bankerTotal }}</span>
        </p>
      </div>
    </section>

    <p v-if="state.phase === 'result' && state.result" class="fx-pop text-center text-xl font-black text-amber-400">
      {{ OUTCOME_LABELS[state.result.outcome] }}
      <span v-if="state.result.playerPair" class="ml-2 text-sm text-sky-300">P페어!</span>
      <span v-if="state.result.bankerPair" class="ml-2 text-sm text-red-300">B페어!</span>
    </p>

    <!-- 히스토리: 원매(구슬) + 중국점(빅로드·빅아이·소로·커크로치) -->
    <div class="flex flex-wrap gap-1">
      <span v-for="(h, i) in state.history" :key="i" class="h-4 w-4 rounded-full" :class="BEAD[h]" />
    </div>
    <BaccaratRoads :history="state.history" />

    <!-- 베팅 -->
    <section class="game-surface rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="grid grid-cols-5 gap-2">
        <button v-for="b in KIND_BUTTONS" :key="b.kind" :disabled="state.phase !== 'betting' || sending"
          class="relative rounded-xl p-2 text-center text-white hover:opacity-80 disabled:opacity-40" :class="b.cls"
          @click="bet(b.kind)">
          <span class="block text-xs font-bold sm:text-sm">{{ b.label }}</span>
          <span class="block text-[10px] opacity-80">{{ b.pay }}</span>
          <!-- 칩 자리를 항상 고정 높이로 확보해, 베팅 시 버튼이 커지며 아래 조작 행이 밀리는 현상(오클릭 원인)을 없앤다 -->
          <div class="mt-1 flex h-8 items-end justify-center">
            <ChipStack v-if="myBetByKind[b.kind]" :amount="myBetByKind[b.kind]" :size="22" :max-chips="4" />
          </div>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <ChipTray v-model="chipValue" :disabled="state.phase !== 'betting' || sending" />
        <BetControls v-if="state.phase === 'betting'" :sending="sending"
          :can-max="canBetMaxBac" :max-label="lastKind ? '마지막 베팅한 곳에 여유분 올인' : '먼저 베팅할 곳을 누르세요'"
          :can-undo="myBetTotal > 0" :can-clear="myBetTotal > 0"
          :can-repeat="canRepeatLastBet" :repeat-label="`직전 베팅 재현 (총 ${lastRoundTotal.toLocaleString()}칩)`"
          @max="betMaxKind" @undo="undoLastBet" @clear="clearMyBets" @repeat="repeatLastBet" />
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">{{ b.nickname }} — {{ b.kind }} · {{ b.amount.toLocaleString() }}칩</p>
      </div>
    </section>
    </div>
    </div>

    <div class="lg:w-72 lg:shrink-0">
      <TableChat :game="game" />
    </div>
    </div>
    <WinCascade ref="cascade" />
    <TableHud :balance="auth.user?.balance ?? 0" :my-bet="myBetTotal" :status-label="PHASE_LABELS[state.phase]" :limit-label="limitLabel" />
  </div>
</template>

<style scoped>
/* 그래픽(Pixi) 모드 캔버스 프레임 — 카드 두 구역이 담기는 고정 높이 */
.pixi-bac-frame {
  height: clamp(200px, 30vh, 280px);
}
</style>
