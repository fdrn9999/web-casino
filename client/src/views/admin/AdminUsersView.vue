<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../../lib/api'

const q = ref('')
const users = ref([])
const detail = ref(null)
const form = ref({ amount: '', reason: '' })
const msg = ref('')

async function search() {
  users.value = (await api(`/admin/users?q=${encodeURIComponent(q.value)}`)).users
}

async function openDetail(id) {
  detail.value = await api(`/admin/users/${id}`)
  form.value = { amount: '', reason: '' }
  msg.value = ''
}

async function act(action, body) {
  msg.value = ''
  try {
    await api(`/admin/users/${detail.value.user.id}/${action}`, { method: 'POST', body })
    msg.value = '처리되었습니다.'
    await openDetail(detail.value.user.id)
    await search()
  } catch (e) {
    msg.value = e.message
  }
}

function grant() { act('grant', { amount: Number(form.value.amount), reason: form.value.reason }) }
function confiscate(all) {
  act('confiscate', { amount: all ? 'all' : Number(form.value.amount), reason: form.value.reason })
}
function ban() {
  if (confirm('이 유저를 차단할까요? 접속 중이면 즉시 종료됩니다.')) act('ban', { reason: form.value.reason })
}

onMounted(search)
</script>

<template>
  <div class="space-y-4">
    <form class="flex gap-2" @submit.prevent="search">
      <input v-model="q" placeholder="아이디/닉네임 검색"
        class="w-full max-w-xs rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm outline-none focus:border-amber-400" />
      <button class="rounded-lg bg-emerald-700 px-4 text-sm hover:bg-emerald-600">검색</button>
    </form>

    <div class="overflow-x-auto rounded-xl border border-emerald-800">
      <table class="w-full min-w-[560px] text-sm">
        <thead class="bg-emerald-900/60 text-left text-emerald-300">
          <tr>
            <th class="p-2">아이디</th><th class="p-2">닉네임</th><th class="p-2">잔액</th>
            <th class="p-2">파산</th><th class="p-2">상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id"
            class="cursor-pointer border-t border-emerald-900 hover:bg-emerald-900/40" @click="openDetail(u.id)">
            <td class="p-2">{{ u.username }}</td>
            <td class="p-2">{{ u.nickname }}</td>
            <td class="p-2">{{ u.balance.toLocaleString() }}칩</td>
            <td class="p-2">{{ u.bankrupt_count }}회</td>
            <td class="p-2">
              <span v-if="u.banned" class="text-red-400">차단됨</span>
              <span v-else-if="u.role === 'admin'" class="text-amber-300">관리자</span>
              <span v-else class="text-emerald-400">정상</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="detail" class="rounded-xl border border-amber-500/30 bg-emerald-900/40 p-4">
      <h2 class="font-bold text-amber-300">{{ detail.user.nickname }} ({{ detail.user.username }})
        — {{ detail.user.balance.toLocaleString() }}칩</h2>
      <p v-if="detail.user.banned" class="mt-1 text-sm text-red-400">차단됨 — 사유: {{ detail.user.ban_reason }}</p>

      <div class="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label class="block text-xs text-emerald-300" for="amount">금액</label>
          <input id="amount" v-model="form.amount" type="number" min="1"
            class="w-28 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
        </div>
        <div class="grow">
          <label class="block text-xs text-emerald-300" for="reason">사유 (필수)</label>
          <input id="reason" v-model="form.reason"
            class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
        </div>
        <button class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold hover:bg-emerald-500" @click="grant">지급</button>
        <button class="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-bold hover:bg-orange-500" @click="confiscate(false)">몰수</button>
        <button class="rounded-lg bg-orange-800 px-3 py-1.5 text-sm font-bold hover:bg-orange-700" @click="confiscate(true)">전액 몰수</button>
        <button v-if="!detail.user.banned" class="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-bold hover:bg-red-600" @click="ban">차단</button>
        <button v-else class="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold hover:bg-emerald-600" @click="act('unban')">차단 해제</button>
      </div>
      <p v-if="msg" class="mt-2 text-sm text-amber-300">{{ msg }}</p>

      <h3 class="mt-4 text-sm font-bold text-emerald-300">최근 거래</h3>
      <div class="mt-1 max-h-60 overflow-y-auto overflow-x-auto rounded border border-emerald-800">
        <table class="w-full min-w-[480px] text-xs">
          <tbody>
            <tr v-for="t in detail.transactions" :key="t.id" class="border-t border-emerald-900">
              <td class="p-1.5 text-emerald-400">{{ t.created_at }}</td>
              <td class="p-1.5">{{ t.type }}</td>
              <td class="p-1.5" :class="t.amount >= 0 ? 'text-emerald-300' : 'text-red-400'">
                {{ t.amount >= 0 ? '+' : '' }}{{ t.amount.toLocaleString() }}</td>
              <td class="p-1.5 text-emerald-400">{{ t.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
