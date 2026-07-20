<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PhaseTimer from '../components/PhaseTimer.vue'
import TableChat from '../components/TableChat.vue'
import TableHud from '../components/TableHud.vue'
import ChipTray from '../components/ChipTray.vue'
import ChipStack from '../components/ChipStack.vue'
import WinCascade from '../components/WinCascade.vue'
import { chipStyleFor } from '../lib/chips'
import { useGameSocket } from '../composables/useGameSocket'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { sfx } = useSound()
const game = useGameSocket('roulette')

const state = ref(null)
const error = ref('')
const sending = ref(false)
const chipValue = ref(100) // 활성 칩(현재 선택된 베팅 단위)
const selected = ref([])
const cascade = ref(null)

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const colorClass = (n) => (n === 0 ? 'bg-emerald-600' : RED.has(n) ? 'bg-red-700' : 'bg-neutral-900')
const pocketHex = (n) => (n === 0 ? '#059669' : RED.has(n) ? '#b91c1c' : '#171717')
const OUTSIDE_BUTTONS = [
  { type: 'red', label: '레드' }, { type: 'black', label: '블랙' },
  { type: 'odd', label: '홀' }, { type: 'even', label: '짝' },
  { type: 'low', label: '1~18' }, { type: 'high', label: '19~36' },
  { type: 'dozen1', label: '1st 12' }, { type: 'dozen2', label: '2nd 12' }, { type: 'dozen3', label: '3rd 12' },
  { type: 'col1', label: '1열' }, { type: 'col2', label: '2열' }, { type: 'col3', label: '3열' },
]
const TYPE_LABELS = Object.fromEntries(OUTSIDE_BUTTONS.map((b) => [b.type, b.label]))

const myBets = computed(() => state.value?.bets.filter((b) => b.nickname === auth.user?.nickname) ?? [])
const myBetTotal = computed(() => myBets.value.reduce((sum, b) => sum + b.amount, 0))
const limitLabel = computed(() =>
  state.value ? `${state.value.rules.minBet.toLocaleString()}~${state.value.rules.maxBet.toLocaleString()}칩` : ''
)
// 이번 라운드 내가 놓은 베팅별(아웃사이드 타입) 누적액 — 칩 스택 표시용
const myOutsideBetTotals = computed(() => {
  const totals = {}
  for (const b of myBets.value) if (b.type !== 'inside') totals[b.type] = (totals[b.type] ?? 0) + b.amount
  return totals
})
// 이번 라운드 내가 놓은 베팅별(번호) 누적액 — 칩 스택 표시용
const myNumberBetTotals = computed(() => {
  const totals = {}
  for (const b of myBets.value) {
    if (b.type === 'inside') for (const n of b.numbers) totals[n] = (totals[n] ?? 0) + b.amount
  }
  return totals
})

// --- 직전 베팅 다시 걸기 ---
const LAST_BET_KEY = `vegas:lastBet:roulette:${route.params.tableId}`
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

// 유러피언 휠 실제 배치 순서
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const SEG = 360 / WHEEL_ORDER.length
const wheelDeg = ref(0)
const wheelSpinning = ref(false)
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 포켓(칸) 색상 링 배경 - conic-gradient. i번째 포켓 중심이 (i*SEG)도(위쪽 기준 시계방향)에 오도록
// -SEG/2 만큼 시작점을 당겨서, 각 포켓이 자기 중심을 기준으로 SEG폭을 갖게 만든다.
const pocketGradient = computed(() => {
  const stops = WHEEL_ORDER.map((n, i) => `${pocketHex(n)} ${(i * SEG).toFixed(3)}deg ${((i + 1) * SEG).toFixed(3)}deg`)
  return `conic-gradient(from ${(-SEG / 2).toFixed(3)}deg, ${stops.join(', ')})`
})
// 포켓 사이 구분선(살짝 어두운 선)
const pocketDividers = computed(() => {
  const gap = 0.55
  return `repeating-conic-gradient(from ${(-SEG / 2).toFixed(3)}deg, transparent 0deg ${(SEG - gap).toFixed(3)}deg, rgba(0,0,0,0.55) ${(SEG - gap).toFixed(3)}deg ${SEG.toFixed(3)}deg)`
})

function spinWheelTo(resultNumber, durationMs) {
  const idx = WHEEL_ORDER.indexOf(resultNumber)
  // 포인터(12시)에 결과 세그먼트가 오도록 하는 절대 각도(mod 360)
  const desiredMod = (((360 - idx * SEG) % 360) + 360) % 360
  const current = wheelDeg.value
  const currentMod = ((current % 360) + 360) % 360
  // 현재 각도에서 목표 각도까지 앞으로만 회전하는 델타
  const delta = ((desiredMod - currentMod) % 360 + 360) % 360
  wheelSpinning.value = true
  // 리셋하지 않고 누적: 최소 5바퀴 + 델타만큼 앞으로 회전
  wheelDeg.value = current + 360 * 5 + delta
  sfx.spinStart()
  setTimeout(() => (wheelSpinning.value = false), durationMs)
}

// --- 굴러가는 공(볼) 연출 ---
// 휠은 시계방향(양수)으로 회전해 결과 번호를 12시 포인터에 맞춘다.
// 공은 반시계방향(음수)으로 더 많이/빠르게 돌다가, 바깥 트랙 → 포켓 반경으로 "떨어지며" 감속해
// 항상 12시(포인터) 위치, 즉 -90deg(mod 360 = 270)에 정착한다.
// 휠도 결과를 항상 12시에 맞추므로, 공과 결과 번호는 매 라운드 정확히 일치한다.
const BALL_TOP_MOD = 270 // -90deg를 양수로 표현한 값
const ballDeg = ref(0)
const ballSpinning = ref(false)
const ballDropped = ref(false)
const ballSnap = ref(false)
const ballDropDurationMs = ref(900)
const spinTimers = []

function clearSpinTimers() {
  spinTimers.splice(0).forEach((id) => clearTimeout(id))
}

function scheduleTicks(startDelay, windowMs) {
  const count = 8
  for (let i = 1; i <= count; i++) {
    // 뒤로 갈수록 틱 간격이 벌어지도록 해 감속하는 느낌을 준다
    const frac = (i / count) ** 1.6
    spinTimers.push(setTimeout(() => sfx.spinTick(), startDelay + frac * windowMs))
  }
}

function spinBallTo(durationMs) {
  const current = ballDeg.value
  const currentMod = ((current % 360) + 360) % 360
  const diff = ((currentMod - BALL_TOP_MOD) % 360 + 360) % 360
  const turns = 360 * 9
  const target = current - diff - turns // 반시계방향(음수)으로 여러 바퀴 돈 뒤 12시에 정착

  ballSpinning.value = true
  // 이전 라운드에 안쪽(포켓)에 놓여 있던 공을 애니메이션 없이 즉시 바깥 트랙으로 되돌린다
  ballSnap.value = true
  ballDropped.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ballSnap.value = false
    })
  })
  ballDeg.value = target

  const dropDelay = durationMs * 0.62
  const dropWindow = Math.max(durationMs - dropDelay, 300)
  ballDropDurationMs.value = dropWindow

  spinTimers.push(setTimeout(() => {
    ballDropped.value = true // 바깥 트랙 -> 포켓 반경으로 "낙하" + 바운스
  }, dropDelay))

  scheduleTicks(dropDelay, dropWindow)

  spinTimers.push(setTimeout(() => {
    ballSpinning.value = false
    sfx.spinTick() // 정착음
  }, durationMs))
}

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'spinning' && state.value?.phase !== 'spinning') {
      const durationMs = (s.rules.spinSeconds - 0.5) * 1000
      spinWheelTo(s.result, durationMs)
      spinBallTo(durationMs)
    }
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      if (myBets.value.length > 0) {
        // 내 베팅 중 하나라도 결과 번호에 적중했으면 승리음, 아니면 패배음
        const hit = myBets.value.some((b) => b.type === 'inside' && b.numbers?.includes(s.result))
        if (hit) {
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
  clearSpinTimers()
  game.disconnect()
})

function toggleNumber(n) {
  sfx.click()
  const i = selected.value.indexOf(n)
  if (i >= 0) selected.value.splice(i, 1)
  else if (selected.value.length < 6) selected.value.push(n)
}

// 이번 배팅으로 해당 스팟의 누적액이 상위 액면으로 "자동 병합"되는 경계를 넘는지 판단한다
// (예: 100짜리 4개 위에 1개를 더 얹어 총 500이 되는 순간 -> 500칩 스타일로 전환).
function crossesDenomination(prevTotal, amt) {
  return chipStyleFor(prevTotal) !== chipStyleFor(prevTotal + amt)
}
function betCrossesDenomination(payload, amt) {
  if (payload.type === 'inside') {
    return (payload.numbers ?? []).some((n) => crossesDenomination(myNumberBetTotals.value[n] ?? 0, amt))
  }
  return crossesDenomination(myOutsideBetTotals.value[payload.type] ?? 0, amt)
}

async function placeBet(payload, amountOverride) {
  // 라운드트립 중 중복 클릭 방지 (서버도 중복은 거부하지만 불필요한 요청/에러 노이즈를 줄임)
  if (sending.value) return
  sending.value = true
  error.value = ''
  const amt = amountOverride ?? chipValue.value
  sfx.chip()
  if (betCrossesDenomination(payload, amt)) sfx.chipStack()
  try {
    const res = await game.emitAck('bet:place', { ...payload, amount: amt })
    if (res.error) {
      error.value = res.error
    } else {
      selected.value = []
      roundBets.value = [...roundBets.value, { ...payload, amount: amt }]
    }
  } finally {
    sending.value = false
  }
}

function betInside() {
  if (![1, 2, 3, 4, 6].includes(selected.value.length)) {
    error.value = '번호를 1·2·3·4·6개 선택하세요.'
    return
  }
  placeBet({ type: 'inside', numbers: [...selected.value] })
}

async function repeatLastBet() {
  if (!canRepeatLastBet.value || sending.value) return
  for (const b of lastRoundBets.value) {
    // eslint-disable-next-line no-await-in-loop
    await placeBet({ type: b.type, numbers: b.numbers }, b.amount)
    if (error.value) break
  }
}

const PHASE_LABELS = { waiting: '대기 중', betting: '베팅하세요!', spinning: '스핀!', result: '결과' }
</script>

<template>
  <div v-if="state" class="pb-20">
  <div class="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1">
    <div class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🎡 {{ state.name }}</h1>
      <span class="rounded-full bg-emerald-800 px-2 py-0.5 text-xs">{{ PHASE_LABELS[state.phase] }}</span>
      <span class="text-xs text-amber-500/80">유러피언 룰렛 (싱글 제로)</span>
      <span class="text-xs text-emerald-400">👥 {{ state.players.length }}</span>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>

    <PhaseTimer :ends-at="state.phaseEndsAt" :total-seconds="state.rules.betSeconds" />

    <!-- 결과/휠 -->
    <section class="rounded-2xl border border-amber-500/20 bg-emerald-900/50 p-4 text-center">
      <div class="relative mx-auto wheel-disc">
        <!-- 포인터 -->
        <div class="pointer-arrow absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1 text-xl text-amber-400 drop-shadow">▼</div>

        <!-- 회전하는 포켓 링 + 번호 -->
        <div class="absolute inset-0 rounded-full border-4 border-amber-500/70 shadow-[inset_0_0_18px_rgba(0,0,0,0.6)]"
          :style="{
            backgroundImage: `${pocketDividers}, ${pocketGradient}`,
            transform: `rotate(${wheelDeg}deg)`,
            transitionProperty: 'transform',
            transitionDuration: wheelSpinning && !reducedMotion ? `${(state.rules.spinSeconds - 0.5)}s` : '0ms',
            transitionTimingFunction: 'cubic-bezier(0.15, 0.6, 0.15, 1)',
          }">
          <!-- 각 포켓의 방사 지점(중심)에 0크기 앵커를 두고, 그 위에 숫자를 중앙정렬.
               숫자는 포켓과 함께 회전하며 top이 바깥(림)을 향하는 실제 룰렛식 방사 배치. -->
          <div v-for="(n, i) in WHEEL_ORDER" :key="n"
            class="absolute left-1/2 top-1/2 h-0 w-0"
            :style="{ transform: `rotate(${i * SEG}deg) translateY(calc(var(--size) * -0.34))` }">
            <span class="pocket-num absolute left-0 top-0 block -translate-x-1/2 -translate-y-1/2 text-xs font-black leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] sm:text-sm"
              :class="state.phase === 'result' && n === state.result ? 'fx-glow-win rounded-full bg-amber-400/40 px-1' : ''">{{ n }}</span>
          </div>
        </div>

        <!-- 굴러가는 공 -->
        <div class="ball-rotor absolute inset-0"
          :style="{
            transform: `rotate(${ballDeg}deg)`,
            transitionProperty: 'transform',
            transitionDuration: ballSpinning && !reducedMotion ? `${(state.rules.spinSeconds - 0.5)}s` : '0ms',
          }">
          <div class="ball-dot absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full bg-white"
            :class="{ 'no-transition': ballSnap || reducedMotion }"
            :style="{
              transform: `translate(-50%, -50%) translateX(calc(var(--size) * ${ballDropped ? '0.40' : '0.47'}))`,
              transitionDuration: `${ballDropDurationMs}ms`,
            }">
          </div>
        </div>

        <!-- 중앙 허브 -->
        <div class="absolute left-1/2 top-1/2 z-10 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-500/70 bg-emerald-950 sm:h-12 sm:w-12"></div>

        <!-- 결과 배지 -->
        <div v-if="state.phase === 'result' && state.result !== null"
          class="fx-pop absolute inset-0 z-20 m-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-white ring-4 ring-amber-400/70"
          :class="colorClass(state.result)">{{ state.result }}</div>
      </div>
      <div v-if="!(state.phase === 'result' && state.result !== null)" class="mt-2 text-sm text-emerald-400">베팅 후 결과를 기다리세요</div>
      <div class="mt-3 flex flex-wrap justify-center gap-1">
        <span v-for="(h, i) in state.history" :key="i"
          class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
          :class="colorClass(h.n)">{{ h.n }}</span>
      </div>
    </section>

    <!-- 번호판 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-3">
      <div class="grid grid-cols-13 gap-1" style="grid-template-columns: repeat(13, minmax(0, 1fr));">
        <button class="relative col-span-1 row-span-3 rounded font-bold text-white"
          :class="[colorClass(0), selected.includes(0) ? 'ring-2 ring-amber-400' : '', state.phase === 'result' && state.result === 0 ? 'fx-glow-win' : '']"
          style="grid-row: span 3;" @click="toggleNumber(0)">0
          <div v-if="myNumberBetTotals[0]" class="bet-chip-stack-pos">
            <ChipStack :amount="myNumberBetTotals[0]" :size="14" :max-chips="4" :show-label="false" />
          </div>
        </button>
        <template v-for="row in 3">
          <button v-for="col in 12" :key="`${row}-${col}`"
            class="relative aspect-square rounded text-xs font-bold text-white sm:text-sm"
            :class="[colorClass((col - 1) * 3 + (4 - row)), selected.includes((col - 1) * 3 + (4 - row)) ? 'ring-2 ring-amber-400' : '', state.phase === 'result' && state.result === (col - 1) * 3 + (4 - row) ? 'fx-glow-win' : '']"
            @click="toggleNumber((col - 1) * 3 + (4 - row))">
            {{ (col - 1) * 3 + (4 - row) }}
            <div v-if="myNumberBetTotals[(col - 1) * 3 + (4 - row)]" class="bet-chip-stack-pos">
              <ChipStack :amount="myNumberBetTotals[(col - 1) * 3 + (4 - row)]" :size="14" :max-chips="4" :show-label="false" />
            </div>
          </button>
        </template>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <button v-for="b in OUTSIDE_BUTTONS" :key="b.type" :disabled="sending || state.phase !== 'betting'"
          class="flex flex-col items-center gap-0.5 rounded bg-emerald-950 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-800 disabled:opacity-40"
          @click="placeBet({ type: b.type })">
          <span>{{ b.label }}</span>
          <ChipStack v-if="myOutsideBetTotals[b.type]" :amount="myOutsideBetTotals[b.type]" :size="14" :max-chips="4" class="mt-0.5" />
        </button>
      </div>
    </section>

    <!-- 조작 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="flex flex-wrap items-end gap-3">
        <ChipTray v-model="chipValue" :disabled="state.phase !== 'betting' || sending" />
        <button v-if="state.phase === 'betting'" :disabled="!canRepeatLastBet || sending"
          class="rounded-lg border border-amber-500/50 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-30"
          :title="canRepeatLastBet ? `직전 베팅 재현 (총 ${lastRoundTotal.toLocaleString()}칩)` : '재현할 직전 베팅이 없거나 잔액이 부족합니다.'"
          @click="repeatLastBet">↺ 직전 베팅</button>
        <button :disabled="state.phase !== 'betting' || sending"
          class="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
          @click="betInside">선택 번호에 베팅 ({{ selected.length }}개)</button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
      <div v-if="state.bets.length" class="mt-3 max-h-32 overflow-y-auto text-xs text-emerald-300">
        <p v-for="(b, i) in state.bets" :key="i">
          {{ b.nickname }} — {{ b.type === 'inside' ? `번호 ${b.numbers.join(',')}` : TYPE_LABELS[b.type] }}
          · {{ b.amount.toLocaleString() }}칩
        </p>
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
.wheel-disc {
  --size: 260px;
  width: var(--size);
  height: var(--size);
}
@media (min-width: 640px) {
  .wheel-disc { --size: 300px; }
}
@media (min-width: 768px) {
  .wheel-disc { --size: 340px; }
}

.pocket-num {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 3px rgba(0, 0, 0, 0.6);
}

.ball-dot {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.7), 0 0 5px rgba(255, 255, 255, 0.85);
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ball-dot.no-transition {
  transition: none !important;
}

.bet-chip-stack-pos {
  position: absolute;
  bottom: -6px;
  right: -6px;
  z-index: 5;
  pointer-events: none;
  transform: scale(0.92);
}

@media (prefers-reduced-motion: reduce) {
  .wheel-disc > div,
  .ball-rotor,
  .ball-dot {
    transition: none !important;
  }
}
</style>
