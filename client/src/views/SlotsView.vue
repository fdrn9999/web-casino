<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useSound } from '../composables/useSound'
import { connectSocket } from '../composables/useSocket'

const auth = useAuthStore()
const { sfx, playJackpot } = useSound()

const state = ref(null)
const bet = ref(0)
const reels = ref(['❔', '❔', '❔'])
const spinning = ref(false)
const result = ref(null)
const error = ref('')

onMounted(async () => {
  connectSocket()
  state.value = await api('/slots/state')
  bet.value = state.value.settings.minBet
})

function adjust(delta) {
  sfx.click()
  const { minBet, maxBet, betStep } = state.value.settings
  bet.value = Math.min(maxBet, Math.max(minBet, bet.value + delta * betStep))
}

async function doSpin() {
  if (spinning.value) return
  error.value = ''
  result.value = null
  spinning.value = true
  sfx.spinStart()
  const ticker = setInterval(() => {
    reels.value = reels.value.map(() => ['🍒', '🍋', '🔔', '⭐', '7'][Math.floor(Math.random() * 5)])
    sfx.spinTick()
  }, 80)
  try {
    const res = await api('/slots/spin', { method: 'POST', body: { bet: bet.value } })
    setTimeout(() => {
      clearInterval(ticker)
      reels.value = res.symbols
      result.value = res
      auth.setBalance(res.balance)
      if (res.jackpotWon) playJackpot()
      else if (res.payout > 0) sfx.win()
      else sfx.lose()
      spinning.value = false
    }, 1200)
  } catch (e) {
    clearInterval(ticker)
    error.value = e.message
    spinning.value = false
  }
}
</script>

<template>
  <div v-if="state" class="mx-auto max-w-lg space-y-4">
    <h1 class="text-xl font-bold text-amber-400">🎰 슬롯머신</h1>

    <div class="rounded-2xl border-4 border-amber-500/60 bg-emerald-900 p-6">
      <div class="flex justify-center gap-3">
        <div v-for="(s, i) in reels" :key="i"
          class="flex h-24 w-20 items-center justify-center rounded-xl bg-emerald-950 text-5xl shadow-inner sm:h-28 sm:w-24">
          {{ s }}
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
      <button :disabled="spinning"
        class="mt-3 w-full rounded-xl bg-amber-500 py-3 text-lg font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-50"
        @click="doSpin">
        {{ spinning ? '스핀 중…' : 'SPIN' }}
      </button>
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
