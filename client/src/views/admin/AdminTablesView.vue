<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../../lib/api'
import { onTablesUpdate } from '../../composables/useSocket'

const tables = ref([])
const form = ref({ game: 'blackjack', name: '', useLimits: false, minBet: 100, maxBet: 5000 })
const msg = ref('')
const editingId = ref(null)
let off

async function load() {
  tables.value = (await api('/tables')).tables
}

function resetForm() {
  form.value = { game: 'blackjack', name: '', useLimits: false, minBet: 100, maxBet: 5000 }
}

async function create() {
  msg.value = ''
  try {
    const body = { game: form.value.game, name: form.value.name }
    if (form.value.useLimits) body.limits = { minBet: Number(form.value.minBet), maxBet: Number(form.value.maxBet) }
    await api('/admin/tables', { method: 'POST', body })
    form.value.name = ''
    await load()
    msg.value = '테이블이 생성되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

function startEdit(t) {
  msg.value = ''
  editingId.value = t.id
  form.value.game = t.game
  form.value.name = t.name
  if (t.limits) {
    form.value.useLimits = true
    form.value.minBet = t.limits.minBet
    form.value.maxBet = t.limits.maxBet
  } else {
    form.value.useLimits = false
    form.value.minBet = 100
    form.value.maxBet = 5000
  }
}

function cancelEdit() {
  editingId.value = null
  resetForm()
  msg.value = ''
}

async function save() {
  msg.value = ''
  try {
    const body = {
      name: form.value.name,
      limits: form.value.useLimits ? { minBet: Number(form.value.minBet), maxBet: Number(form.value.maxBet) } : null,
    }
    await api(`/admin/tables/${editingId.value}`, { method: 'PUT', body })
    editingId.value = null
    resetForm()
    await load()
    msg.value = '테이블이 수정되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

function submitForm() {
  if (editingId.value) save()
  else create()
}

async function act(id, path, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return
  msg.value = ''
  try {
    if (path === 'delete') await api(`/admin/tables/${id}`, { method: 'DELETE' })
    else await api(`/admin/tables/${id}/${path}`, { method: 'POST' })
    await load()
  } catch (e) {
    msg.value = e.message
  }
}

onMounted(() => {
  load()
  off = onTablesUpdate(({ tables: t }) => (tables.value = t))
})
onUnmounted(() => off?.())
</script>

<template>
  <div class="space-y-4">
    <form class="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="submitForm">
      <div>
        <label class="block text-xs text-emerald-300" for="game">게임</label>
        <select id="game" v-model="form.game" :disabled="!!editingId" class="rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm disabled:opacity-50">
          <option value="blackjack">블랙잭</option>
          <option value="roulette">룰렛</option>
          <option value="baccarat">바카라</option>
        </select>
      </div>
      <div class="grow">
        <label class="block text-xs text-emerald-300" for="name">테이블 이름</label>
        <input id="name" v-model="form.name" class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" />
      </div>
      <label class="flex items-center gap-1 pb-1.5 text-xs text-emerald-300">
        <input v-model="form.useLimits" type="checkbox" class="accent-amber-500" /> 한도 지정
      </label>
      <template v-if="form.useLimits">
        <input v-model="form.minBet" type="number" class="w-24 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" placeholder="최소" />
        <input v-model="form.maxBet" type="number" class="w-24 rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5 text-sm" placeholder="최대" />
      </template>
      <button class="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-bold text-emerald-950 hover:bg-amber-400">{{ editingId ? '수정 저장' : '생성' }}</button>
      <button v-if="editingId" type="button" class="rounded-lg border border-emerald-700 px-4 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900" @click="cancelEdit">취소</button>
    </form>
    <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>

    <div class="overflow-x-auto rounded-xl border border-emerald-800">
      <table class="w-full min-w-[560px] text-sm">
        <thead class="bg-emerald-900/60 text-left text-emerald-300">
          <tr><th class="p-2">게임</th><th class="p-2">이름</th><th class="p-2">인원</th><th class="p-2">한도</th><th class="p-2">상태</th><th class="p-2">동작</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tables" :key="t.id" class="border-t border-emerald-900">
            <td class="p-2">{{ t.game }}</td>
            <td class="p-2 font-bold">{{ t.name }}</td>
            <td class="p-2">{{ t.playerCount }}</td>
            <td class="p-2">{{ t.limits ? `${t.limits.minBet}~${t.limits.maxBet}` : '전역 설정' }}</td>
            <td class="p-2">
              <span :class="t.status === 'open' ? 'text-emerald-400' : 'text-red-400'">{{ t.status === 'open' ? '운영 중' : '닫힘' }}</span>
            </td>
            <td class="flex gap-2 p-2 text-xs">
              <button class="text-amber-300 hover:underline" @click="startEdit(t)">수정</button>
              <button v-if="t.status === 'open'" class="text-orange-400 hover:underline"
                @click="act(t.id, 'close', '테이블을 닫을까요? 진행 중 베팅은 환불됩니다.')">닫기</button>
              <button v-else class="text-emerald-300 hover:underline" @click="act(t.id, 'reopen')">열기</button>
              <button class="text-red-400 hover:underline"
                @click="act(t.id, 'delete', '테이블을 삭제할까요? 진행 중 베팅은 환불됩니다.')">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
