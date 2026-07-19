<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'
import { connectSocket } from '../composables/useSocket'

const auth = useAuthStore()
const { sfx, playJackpot } = useSound()

const SYMS = ['🍒', '🍋', '🔔', '⭐', '7']
const SPIN_SPEED = 1600 // px/sec continuous scroll speed
const MIN_SPIN_MS = 900 // minimum visual spin time before reels start stopping
const STOP_STAGGER_MS = 180 // delay between each reel starting its stop
const STOP_DURATION_MS = 550 // duration of each reel's stop/deceleration tween
const AUTO_SPIN_DELAY = 700 // gap between auto-spins

function randomSym() {
  return SYMS[Math.floor(Math.random() * SYMS.length)]
}
function buildStrip(n) {
  return Array.from({ length: n }, randomSym)
}
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

const state = ref(null)
const bet = ref(0)
const spinning = ref(false)
const result = ref(null)
const error = ref('')
const autoSpin = ref(false)

// --- reel visuals ---
const reelStrips = ref([['❔'], ['❔'], ['❔']])
const reelY = ref([0, 0, 0])
const reelState = ref(['idle', 'idle', 'idle']) // idle | spinning | stopping | stopped

const reelWindowEls = [null, null, null] // plain DOM refs, imperative use only
const itemHeights = [96, 96, 96]
const tweens = [null, null, null]
const reelResolvers = [null, null, null]
const stopTargets = ['', '', '']

let rafId = null
let lastTs = 0
let unmounted = false
let autoSpinTimer = null
let autoSpinLoopRunning = false
const pendingTimeouts = new Set()
const pendingWaitResolvers = new Set()

function setReelEl(el, i) {
  reelWindowEls[i] = el
}

function wait(ms) {
  return new Promise((resolve) => {
    let id
    // Tracked alongside reelResolvers/hardStopReels: onUnmounted settles any
    // still-pending waits so an awaiting doSpin/stopReelsSequentially chain
    // unwinds instead of hanging forever once the timer is cleared.
    const settle = () => {
      pendingTimeouts.delete(id)
      pendingWaitResolvers.delete(settle)
      resolve()
    }
    id = setTimeout(settle, ms)
    pendingTimeouts.add(id)
    pendingWaitResolvers.add(settle)
  })
}

function ensureRafRunning() {
  if (rafId == null) {
    lastTs = 0
    rafId = requestAnimationFrame(tickReels)
  }
}

function tickReels(ts) {
  if (!lastTs) lastTs = ts
  const dt = (ts - lastTs) / 1000
  lastTs = ts
  let anyActive = false

  for (let i = 0; i < 3; i++) {
    if (reelState.value[i] === 'spinning') {
      anyActive = true
      reelY.value[i] -= SPIN_SPEED * dt
      const ih = itemHeights[i] || 96
      const idx = Math.abs(reelY.value[i]) / ih
      if (idx > reelStrips.value[i].length - 8) {
        for (let k = 0; k < 8; k++) reelStrips.value[i].push(randomSym())
      }
    } else if (reelState.value[i] === 'stopping') {
      const tw = tweens[i]
      if (tw) {
        anyActive = true
        const p = Math.min(1, (ts - tw.start) / tw.duration)
        const eased = easeOutCubic(p)
        reelY.value[i] = tw.from + (tw.to - tw.from) * eased
        if (p >= 1) {
          tweens[i] = null
          sfx.spinTick()
          landReel(i)
        }
      }
    }
  }

  if (anyActive) {
    rafId = requestAnimationFrame(tickReels)
  } else {
    rafId = null
    lastTs = 0
  }
}

function landReel(i) {
  reelState.value[i] = 'stopped'
  reelStrips.value[i] = [stopTargets[i]]
  reelY.value[i] = 0
  const resolve = reelResolvers[i]
  reelResolvers[i] = null
  if (resolve) resolve()
}

function startReelSpin() {
  for (let i = 0; i < 3; i++) {
    const el = reelWindowEls[i]
    itemHeights[i] = el ? el.clientHeight : itemHeights[i]
    reelStrips.value[i] = buildStrip(40)
    reelY.value[i] = 0
    reelState.value[i] = 'spinning'
    tweens[i] = null
  }
  ensureRafRunning()
}

function stopReel(i, symbol) {
  return new Promise((resolve) => {
    const el = reelWindowEls[i]
    const itemHeight = Math.max(el ? el.clientHeight : itemHeights[i] || 96, 1)
    itemHeights[i] = itemHeight
    const currentPos = reelY.value[i]
    const currentIndex = Math.abs(currentPos) / itemHeight
    const finalIndex = Math.ceil(currentIndex) + 4
    const strip = reelStrips.value[i]
    while (strip.length <= finalIndex) strip.push(randomSym())
    strip[finalIndex] = symbol
    stopTargets[i] = symbol
    reelResolvers[i] = resolve
    tweens[i] = { from: currentPos, to: -(finalIndex * itemHeight), start: performance.now(), duration: STOP_DURATION_MS }
    reelState.value[i] = 'stopping'
    ensureRafRunning()
  })
}

async function stopReelsSequentially(symbols) {
  const promises = []
  for (let i = 0; i < 3; i++) {
    if (i > 0) await wait(STOP_STAGGER_MS)
    promises.push(stopReel(i, symbols[i]))
  }
  await Promise.all(promises)
}

function hardStopReels() {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  lastTs = 0
  for (let i = 0; i < 3; i++) {
    tweens[i] = null
    if (reelState.value[i] === 'spinning' || reelState.value[i] === 'stopping') {
      reelState.value[i] = 'idle'
    }
    if (reelResolvers[i]) {
      const r = reelResolvers[i]
      reelResolvers[i] = null
      r()
    }
  }
}

onMounted(async () => {
  connectSocket()
  state.value = await api('/slots/state')
  bet.value = state.value.settings.minBet
})

onUnmounted(() => {
  unmounted = true
  autoSpin.value = false
  if (autoSpinTimer) {
    clearTimeout(autoSpinTimer)
    autoSpinTimer = null
  }
  pendingTimeouts.forEach((id) => clearTimeout(id))
  pendingTimeouts.clear()
  // Settle any wait() promises still pending so awaiting doSpin/
  // stopReelsSequentially chains unwind instead of hanging forever.
  ;[...pendingWaitResolvers].forEach((settle) => settle())
  pendingWaitResolvers.clear()
  hardStopReels()
})

function adjust(delta) {
  sfx.click()
  const { minBet, maxBet, betStep } = state.value.settings
  bet.value = Math.min(maxBet, Math.max(minBet, bet.value + delta * betStep))
}

// Runs one spin end-to-end. Never throws — returns the server result on
// success, or null if it failed/was aborted (error.value is set in that case).
async function doSpin() {
  if (spinning.value) return null
  error.value = ''
  result.value = null
  spinning.value = true
  sfx.spinStart()
  startReelSpin()
  const startedAt = performance.now()
  try {
    const res = await api('/slots/spin', { method: 'POST', body: { bet: bet.value } })
    if (unmounted) return null
    const elapsed = performance.now() - startedAt
    if (elapsed < MIN_SPIN_MS) await wait(MIN_SPIN_MS - elapsed)
    if (unmounted) return null
    await stopReelsSequentially(res.symbols)
    if (unmounted) return null
    result.value = res
    auth.setBalance(res.balance)
    if (res.jackpotWon) playJackpot()
    else if (res.payout > 0) sfx.win()
    else sfx.lose()
    spinning.value = false
    resumeAutoSpinIfNeeded()
    return res
  } catch (e) {
    hardStopReels()
    error.value = e.message
    spinning.value = false
    resumeAutoSpinIfNeeded()
    return null
  }
}

// If auto-spin was toggled on while a manual spin was still in flight,
// autoSpinLoop() returned immediately (its `spinning.value` guard fired)
// without scheduling anything. Once this spin finishes, resume the loop
// here — but only if no loop is already active, so we never double-spin.
function resumeAutoSpinIfNeeded() {
  if (autoSpin.value && !autoSpinLoopRunning) autoSpinLoop()
}

function toggleAutoSpin() {
  sfx.click()
  if (autoSpin.value) {
    autoSpin.value = false
    // 딜레이 대기 중 정지 시 예약 타이머만 죽으므로, 루프 플래그도 함께 초기화해야
    // 이후 재시작(토글 온)이 "이미 실행 중"으로 오인돼 멈추는 것을 막는다.
    autoSpinLoopRunning = false
    if (autoSpinTimer) {
      clearTimeout(autoSpinTimer)
      autoSpinTimer = null
    }
  } else {
    autoSpin.value = true
    autoSpinLoop()
  }
}

async function autoSpinLoop() {
  // autoSpinLoopRunning ensures exactly one active loop chain at a time. If
  // this call fires while a spin is already in flight (e.g. toggled on
  // mid-manual-spin), it returns here and resumeAutoSpinIfNeeded() restarts
  // the loop once that spin completes — it never double-schedules, because
  // the flag stays true for the whole lifetime of the active chain.
  if (unmounted || !autoSpin.value || spinning.value || autoSpinLoopRunning) return
  autoSpinLoopRunning = true
  if (bet.value > (auth.user?.balance ?? 0)) {
    autoSpin.value = false
    error.value = '칩이 부족합니다.'
    autoSpinLoopRunning = false
    return
  }
  const res = await doSpin()
  if (unmounted || !autoSpin.value) {
    autoSpinLoopRunning = false
    return
  }
  if (!res) {
    autoSpin.value = false // doSpin already populated error.value
    autoSpinLoopRunning = false
    return
  }
  if (res.jackpotWon) {
    autoSpin.value = false // stop so the user can see the celebration
    autoSpinLoopRunning = false
    return
  }
  const timerId = setTimeout(() => {
    autoSpinTimer = null
    pendingTimeouts.delete(timerId)
    autoSpinLoopRunning = false
    autoSpinLoop()
  }, AUTO_SPIN_DELAY)
  autoSpinTimer = timerId
  pendingTimeouts.add(timerId)
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-lg space-y-4">
    <h1 class="text-xl font-bold text-amber-400">🎰 슬롯머신</h1>

    <div class="rounded-2xl border-4 border-amber-500/60 bg-emerald-900 p-6">
      <div class="flex justify-center gap-3">
        <div v-for="(strip, i) in reelStrips" :key="i" :ref="(el) => setReelEl(el, i)"
          class="relative h-24 w-20 overflow-hidden rounded-xl bg-emerald-950 shadow-inner sm:h-28 sm:w-24"
          :class="{ 'ring-2 ring-amber-400/70': reelState[i] === 'spinning' || reelState[i] === 'stopping' }">
          <div class="flex will-change-transform flex-col" :style="{ transform: `translateY(${reelY[i]}px)` }">
            <div v-for="(sym, j) in strip" :key="j"
              class="flex h-24 w-20 shrink-0 items-center justify-center text-5xl sm:h-28 sm:w-24">
              {{ sym }}
            </div>
          </div>
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40"></div>
        </div>
      </div>

      <div v-if="result" class="mt-4 text-center">
        <p v-if="result.jackpotWon" class="animate-bounce text-xl font-black text-amber-400">
          💎 잭팟! {{ result.jackpotAmount.toLocaleString() }}칩 당첨!
        </p>
        <p v-else-if="result.payout > 0" class="text-lg font-bold text-amber-300">
          {{ result.label }} — +{{ result.payout.toLocaleString() }}칩
        </p>
        <p v-else class="text-emerald-400">아쉽네요! 다음 기회에…</p>
      </div>

      <div class="mt-5 flex items-center justify-center gap-2">
        <button class="h-10 w-10 rounded-lg bg-emerald-800 text-lg hover:bg-emerald-700" @click="adjust(-1)">−</button>
        <span class="w-28 text-center font-bold tabular-nums">{{ bet.toLocaleString() }} 칩</span>
        <button class="h-10 w-10 rounded-lg bg-emerald-800 text-lg hover:bg-emerald-700" @click="adjust(1)">＋</button>
      </div>

      <div class="mt-3 flex gap-2">
        <button :disabled="spinning || autoSpin"
          class="flex-1 rounded-xl bg-amber-500 py-3 text-lg font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-50"
          @click="doSpin">
          {{ autoSpin ? '오토 스핀 중…' : spinning ? '스핀 중…' : 'SPIN' }}
        </button>
        <button
          class="rounded-xl px-4 py-3 text-lg font-black transition-colors"
          :class="autoSpin ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-emerald-700 text-amber-200 hover:bg-emerald-600'"
          @click="toggleAutoSpin">
          {{ autoSpin ? '⏹ 정지' : '🔁 오토 스핀' }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-center text-sm text-red-400">{{ error }}</p>
    </div>

    <details class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 text-sm">
      <summary class="cursor-pointer font-bold text-amber-300">배당표</summary>
      <ul class="mt-2 space-y-1 text-emerald-200">
        <li v-for="p in state.paytable" :key="p.label" class="flex justify-between">
          <span>{{ p.match.join(' ') }}</span><span>{{ p.label }}</span>
        </li>
      </ul>
    </details>
  </div>
</template>
