<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../../lib/api'

const GROUPS = [
  { key: 'economy', label: '이코노미' },
  { key: 'slots', label: '슬롯머신' },
  { key: 'blackjack', label: '블랙잭' },
  { key: 'roulette', label: '룰렛' },
]

const SETTING_LABELS = {
  signupBonus: '가입 지급 칩', dailyBonus: '일일 출석 보너스', reliefAmount: '파산 구제액',
  reliefThreshold: '구제 기준 잔액(미만)', reliefCooldownMin: '구제 쿨다운(분)',
  minBet: '최소 베팅', maxBet: '최대 베팅', betStep: '베팅 단위',
  jackpotRate: '잭팟 적립률(0~0.2)', jackpotSeed: '잭팟 시드 금액',
  decks: '슈 덱 수(1~8)', hitSoft17: '딜러 소프트17 히트', surrenderAllowed: '서렌더 허용',
  doubleAllowed: '더블 허용', splitAllowed: '스플릿 허용', blackjackPayout: '블랙잭 배당(1.5=3:2, 1.2=6:5)',
  betSeconds: '베팅 시간(초)', turnSeconds: '턴 시간(초)',
  spinSeconds: '스핀 연출 시간(초)', tiePayout: '타이 배당', pairPayout: '페어 배당',
}

const group = ref('blackjack')
const settings = ref(null)
const msg = ref('')

async function load() {
  msg.value = ''
  settings.value = (await api(`/admin/settings/${group.value}`)).settings
}

async function save() {
  msg.value = ''
  try {
    const res = await api(`/admin/settings/${group.value}`, { method: 'PUT', body: settings.value })
    settings.value = res.settings
    msg.value = '저장되었습니다. 진행 중인 라운드에는 영향이 없고 다음 라운드부터 적용됩니다.'
  } catch (e) {
    msg.value = e.message
  }
}

watch(group, load)
onMounted(load)
</script>

<template>
  <div class="max-w-xl space-y-4">
    <div class="flex items-center gap-2">
      <label class="text-sm text-emerald-300" for="group">설정 그룹</label>
      <select id="group" v-model="group" class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm">
        <option v-for="g in GROUPS" :key="g.key" :value="g.key">{{ g.label }}</option>
      </select>
    </div>

    <form v-if="settings" class="space-y-3 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="save">
      <div v-for="(value, key) in settings" :key="key" class="flex items-center justify-between gap-3">
        <label :for="key" class="text-sm text-emerald-200">{{ SETTING_LABELS[key] ?? key }}</label>
        <input v-if="typeof value === 'boolean'" :id="key" v-model="settings[key]" type="checkbox" class="h-4 w-4 accent-amber-500" />
        <input v-else :id="key" v-model.number="settings[key]" type="number" step="any"
          class="w-32 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-right text-sm" />
      </div>
      <button class="w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-emerald-950 hover:bg-amber-400">저장</button>
      <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>
    </form>
  </div>
</template>
