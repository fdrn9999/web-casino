<script setup>
import { ref } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const open = ref(false)
const status = ref(null)
const error = ref('')
const loading = ref(false)
const claiming = ref(false)

async function refresh() {
  status.value = await api('/attendance')
}

async function show() {
  error.value = ''
  loading.value = true
  try {
    await refresh()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
  open.value = true
}

function close() {
  open.value = false
}

async function claim() {
  if (claiming.value || status.value?.todayClaimed) return
  error.value = ''
  claiming.value = true
  try {
    const res = await api('/attendance', { method: 'POST' })
    auth.setBalance(res.balance)
    await refresh()
  } catch (e) {
    error.value = e.message
  } finally {
    claiming.value = false
  }
}

defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @click.self="close">
      <div class="w-full max-w-md rounded-2xl border border-amber-500/40 bg-emerald-950 p-6">
        <h2 class="text-lg font-bold text-amber-300">📅 출석부</h2>
        <p class="mt-1 text-xs text-emerald-300">매일 출석하면 연속 일수에 따라 칩을 받을 수 있어요. 하루라도 빠지면 연속 기록이 초기화됩니다.</p>

        <div v-if="status" class="mt-4">
          <div class="grid grid-cols-7 gap-1.5">
            <div
              v-for="(reward, idx) in status.rewards"
              :key="idx"
              class="flex flex-col items-center justify-center rounded-lg border p-1.5 text-center"
              :class="(idx + 1) <= status.streak
                ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                : 'border-emerald-700/50 bg-emerald-900/40 text-emerald-400/70'"
            >
              <span class="text-[11px] font-bold">{{ idx + 1 }}일</span>
              <span class="text-[10px]">{{ reward.toLocaleString() }}</span>
            </div>
          </div>
          <p class="mt-3 text-sm text-emerald-200">
            현재 연속 출석: <b class="text-amber-300">{{ status.streak }}일</b>
          </p>
        </div>
        <p v-else-if="loading" class="mt-4 text-sm text-emerald-300">불러오는 중...</p>

        <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>

        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm text-emerald-300 hover:text-amber-300" @click="close">닫기</button>
          <button
            v-if="status"
            :disabled="status.todayClaimed || claiming"
            class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-40"
            @click="claim"
          >
            {{ status.todayClaimed ? '오늘 출석 완료' : `출석하고 ${status.nextReward.toLocaleString()}칩 받기` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
