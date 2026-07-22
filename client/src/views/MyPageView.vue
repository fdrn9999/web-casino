<script setup>
import { ref, onMounted } from 'vue'
import { api, ApiError } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()

const GAME_LABELS = { slots: '슬롯', blackjack: '블랙잭', roulette: '룰렛', baccarat: '바카라' }
// 바카라는 로비와 동일한 🀄 사용 — 🂡(플레잉카드 블록)는 Windows 폰트에 없어 깨져 보인다
const GAME_ICONS = { slots: '🎰', blackjack: '🃏', roulette: '🎡', baccarat: '🀄' }
const RESULT_LABELS = { win: '승', lose: '패', push: '무' }
const PAGE_SIZE = 20

// ── 베팅 기록 ──────────────────────────────────────────
const bets = ref([])
const betsTotal = ref(0)
const betsLoading = ref(false)
const betsError = ref('')

async function loadBets({ append = false } = {}) {
  betsLoading.value = true
  betsError.value = ''
  try {
    const offset = append ? bets.value.length : 0
    const data = await api(`/me/bets?limit=${PAGE_SIZE}&offset=${offset}`)
    bets.value = append ? [...bets.value, ...data.bets] : data.bets
    betsTotal.value = data.total
  } catch (e) {
    betsError.value = e.message
  } finally {
    betsLoading.value = false
  }
}

// ── 비밀번호 변경 ──────────────────────────────────────
const pwForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const pwLoading = ref(false)
const pwError = ref('')
const pwSuccess = ref('')

async function changePassword() {
  pwError.value = ''
  pwSuccess.value = ''
  const { currentPassword, newPassword, confirmPassword } = pwForm.value
  if (!currentPassword) {
    pwError.value = '현재 비밀번호를 입력해 주세요.'
    return
  }
  if (newPassword.length < 8) {
    pwError.value = '새 비밀번호는 8자 이상이어야 합니다.'
    return
  }
  if (newPassword === currentPassword) {
    pwError.value = '새 비밀번호는 현재 비밀번호와 달라야 합니다.'
    return
  }
  if (newPassword !== confirmPassword) {
    pwError.value = '새 비밀번호 확인이 일치하지 않습니다.'
    return
  }
  pwLoading.value = true
  try {
    await api('/me/password', { method: 'POST', body: { currentPassword, newPassword } })
    pwSuccess.value = '비밀번호가 변경되었습니다.'
    pwForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  } catch (e) {
    pwError.value = e instanceof ApiError ? e.message : '비밀번호 변경에 실패했습니다.'
  } finally {
    pwLoading.value = false
  }
}

onMounted(() => loadBets())
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <h1 class="text-xl font-bold text-amber-400">👤 {{ auth.user?.nickname }}의 마이페이지</h1>

    <!-- 베팅 기록 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/40 p-5">
      <h2 class="mb-3 text-sm font-bold text-amber-300">베팅 기록</h2>

      <div v-if="betsLoading && bets.length === 0" class="py-8 text-center text-sm text-emerald-300">불러오는 중…</div>

      <div v-else-if="betsError" class="rounded-lg bg-red-950/50 p-4 text-center text-sm text-red-300">
        <p>{{ betsError }}</p>
        <button class="mt-3 rounded-lg bg-red-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700"
          @click="loadBets()">다시 시도</button>
      </div>

      <div v-else-if="bets.length === 0" class="py-8 text-center text-sm text-emerald-400">
        아직 베팅 기록이 없습니다. 게임을 플레이해 보세요!
      </div>

      <template v-else>
        <div class="overflow-x-auto rounded-xl border border-emerald-800/60">
          <table class="w-full min-w-[480px] text-xs">
            <thead>
              <tr class="border-b border-emerald-800 text-emerald-400">
                <th class="p-2 text-left font-medium">게임</th>
                <th class="p-2 text-right font-medium">베팅액</th>
                <th class="p-2 text-right font-medium">획득액</th>
                <th class="p-2 text-center font-medium">결과</th>
                <th class="p-2 text-right font-medium">시각</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in bets" :key="b.id" class="border-t border-emerald-900">
                <td class="p-2">{{ GAME_ICONS[b.game] ?? '🎲' }} {{ GAME_LABELS[b.game] ?? b.game }}</td>
                <td class="p-2 text-right text-emerald-300">{{ b.amount.toLocaleString() }}칩</td>
                <td class="p-2 text-right" :class="b.payout > 0 ? 'text-amber-300' : 'text-emerald-500'">
                  {{ b.payout.toLocaleString() }}칩</td>
                <td class="p-2 text-center">
                  <span class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    :class="{
                      'bg-emerald-700/60 text-emerald-200': b.result === 'win',
                      'bg-red-900/60 text-red-300': b.result === 'lose',
                      'bg-gray-700/60 text-gray-300': b.result === 'push',
                    }">{{ RESULT_LABELS[b.result] }}</span>
                </td>
                <td class="p-2 text-right text-emerald-400">{{ b.created_at }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 text-center">
          <button v-if="bets.length < betsTotal" :disabled="betsLoading"
            class="rounded-lg border border-emerald-700 px-4 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-800 disabled:opacity-50"
            @click="loadBets({ append: true })">
            {{ betsLoading ? '불러오는 중…' : '더 보기' }}
          </button>
          <p v-else class="text-[11px] text-emerald-500">전체 {{ betsTotal.toLocaleString() }}건</p>
        </div>
      </template>
    </section>

    <!-- 비밀번호 변경 -->
    <section class="rounded-2xl border border-emerald-800 bg-emerald-900/40 p-5">
      <h2 class="mb-3 text-sm font-bold text-amber-300">비밀번호 변경</h2>
      <form class="space-y-3" @submit.prevent="changePassword">
        <div>
          <label class="mb-1 block text-sm text-emerald-200" for="currentPassword">현재 비밀번호</label>
          <input id="currentPassword" v-model="pwForm.currentPassword" type="password" autocomplete="current-password"
            class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
        </div>
        <div>
          <label class="mb-1 block text-sm text-emerald-200" for="newPassword">새 비밀번호 (8자 이상)</label>
          <input id="newPassword" v-model="pwForm.newPassword" type="password" autocomplete="new-password"
            class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
        </div>
        <div>
          <label class="mb-1 block text-sm text-emerald-200" for="confirmPassword">새 비밀번호 확인</label>
          <input id="confirmPassword" v-model="pwForm.confirmPassword" type="password" autocomplete="new-password"
            class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
        </div>
        <p v-if="pwError" class="text-sm text-red-400">{{ pwError }}</p>
        <p v-if="pwSuccess" class="text-sm text-emerald-300">{{ pwSuccess }}</p>
        <button :disabled="pwLoading"
          class="w-full rounded-lg bg-amber-500 py-2 font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-50">
          {{ pwLoading ? '변경 중...' : '비밀번호 변경' }}
        </button>
      </form>
    </section>
  </div>
</template>
