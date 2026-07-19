<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PhaseTimer from '../components/PhaseTimer.vue'
import TableChat from '../components/TableChat.vue'
import TableHud from '../components/TableHud.vue'
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
const amount = ref(100)
const selected = ref([])

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const colorClass = (n) => (n === 0 ? 'bg-emerald-600' : RED.has(n) ? 'bg-red-700' : 'bg-neutral-900')
const OUTSIDE_BUTTONS = [
  { type: 'red', label: '레드' }, { type: 'black', label: '블랙' },
  { type: 'odd', label: '홀' }, { type: 'even', label: '짝' },
  { type: 'low', label: '1~18' }, { type: 'high', label: '19~36' },
  { type: 'dozen1', label: '1st 12' }, { type: 'dozen2', label: '2nd 12' }, { type: 'dozen3', label: '3rd 12' },
  { type: 'col1', label: '1열' }, { type: 'col2', label: '2열' }, { type: 'col3', label: '3열' },
]
const CHIPS = [100, 500, 1000, 5000]
const TYPE_LABELS = Object.fromEntries(OUTSIDE_BUTTONS.map((b) => [b.type, b.label]))

const myBets = computed(() => state.value?.bets.filter((b) => b.nickname === auth.user?.nickname) ?? [])
const myBetTotal = computed(() => myBets.value.reduce((sum, b) => sum + b.amount, 0))
const limitLabel = computed(() =>
  state.value ? `${state.value.rules.minBet.toLocaleString()}~${state.value.rules.maxBet.toLocaleString()}칩` : ''
)

// 유러피언 휠 실제 배치 순서
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const SEG = 360 / WHEEL_ORDER.length
const wheelDeg = ref(0)
const wheelSpinning = ref(false)
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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

onMounted(async () => {
  try {
    state.value = await game.connect(route.params.tableId)
  } catch {
    return
  }
  game.onState((s) => {
    if (s.phase === 'spinning' && state.value?.phase !== 'spinning') {
      spinWheelTo(s.result, (s.rules.spinSeconds - 0.5) * 1000)
    }
    if (s.phase === 'result' && state.value?.phase !== 'result') {
      if (myBets.value.length > 0) {
        // 내 베팅 중 하나라도 결과 번호에 적중했으면 승리음, 아니면 패배음
        const hit = myBets.value.some((b) => b.type === 'inside' && b.numbers?.includes(s.result))
        ;(hit ? sfx.win : sfx.lose)()
      }
    }
    state.value = s
  })
})
onUnmounted(() => {
  game.disconnect()
})

function toggleNumber(n) {
  sfx.click()
  const i = selected.value.indexOf(n)
  if (i >= 0) selected.value.splice(i, 1)
  else if (selected.value.length < 6) selected.value.push(n)
}

async function bet(payload) {
  error.value = ''
  sfx.chip()
  const res = await game.emitAck('bet:place', { ...payload, amount: amount.value })
  if (res.error) error.value = res.error
  else selected.value = []
}

function betInside() {
  if (![1, 2, 3, 4, 6].includes(selected.value.length)) {
    error.value = '번호를 1·2·3·4·6개 선택하세요.'
    return
  }
  bet({ type: 'inside', numbers: [...selected.value] })
}

const PHASE_LABELS = { waiting: '대기 중', betting: '베팅하세요!', spinning: '스핀!', result: '결과' }
</script>

<template>
  <div v-if="state" class="mx-auto max-w-4xl space-y-4 pb-20">
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
      <div class="relative mx-auto h-44 w-44 sm:h-52 sm:w-52">
        <div class="absolute left-1/2 top-0 z-10 -translate-x-1/2 text-amber-400">▼</div>
        <div class="h-full w-full rounded-full border-4 border-amber-500/60"
          :style="{
            transform: `rotate(${wheelDeg}deg)`,
            transition: wheelSpinning && !reducedMotion ? `transform ${(state.rules.spinSeconds - 0.5)}s cubic-bezier(0.15, 0.6, 0.15, 1)` : 'none',
          }">
          <div v-for="(n, i) in WHEEL_ORDER" :key="n"
            class="absolute left-1/2 top-1/2 origin-top-left text-[9px] font-bold sm:text-[10px]"
            :style="{ transform: `rotate(${i * SEG - 90}deg) translateX(64px) rotate(90deg)` }"
            :class="n === 0 ? 'text-emerald-400' : RED.has(n) ? 'text-red-400' : 'text-neutral-300'">
            {{ n }}
          </div>
        </div>
        <div v-if="state.phase === 'result' && state.result !== null"
          class="fx-pop absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-white"
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
        <button class="col-span-1 row-span-3 rounded font-bold text-white"
          :class="[colorClass(0), selected.includes(0) ? 'ring-2 ring-amber-400' : '', state.phase === 'result' && state.result === 0 ? 'fx-glow-win' : '']"
          style="grid-row: span 3;" @click="toggleNumber(0)">0</button>
        <template v-for="row in 3">
          <button v-for="col in 12" :key="`${row}-${col}`"
            class="aspect-square rounded text-xs font-bold text-white sm:text-sm"
            :class="[colorClass((col - 1) * 3 + (4 - row)), selected.includes((col - 1) * 3 + (4 - row)) ? 'ring-2 ring-amber-400' : '', state.phase === 'result' && state.result === (col - 1) * 3 + (4 - row) ? 'fx-glow-win' : '']"
            @click="toggleNumber((col - 1) * 3 + (4 - row))">
            {{ (col - 1) * 3 + (4 - row) }}
          </button>
        </template>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <button v-for="b in OUTSIDE_BUTTONS" :key="b.type"
          class="rounded bg-emerald-950 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-800"
          @click="bet({ type: b.type })">{{ b.label }}</button>
      </div>
    </section>

    <!-- 조작 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <button v-for="v in CHIPS" :key="v"
          class="rounded-full border-2 px-3 py-2 text-xs font-bold"
          :class="amount === v ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-800'"
          @click="amount = v; sfx.click()">{{ v.toLocaleString() }}</button>
        <button :disabled="state.phase !== 'betting'"
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

    <TableChat :game="game" />
    <TableHud :balance="auth.user?.balance ?? 0" :my-bet="myBetTotal" :status-label="PHASE_LABELS[state.phase]" :limit-label="limitLabel" />
  </div>
</template>
