<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const open = ref(false)
const status = ref(null)
const error = ref('')
const done = ref(false)
let timer

async function refresh() {
  status.value = await api('/relief/status')
}

async function show() {
  error.value = ''
  done.value = false
  try {
    await refresh()
  } catch (e) {
    error.value = e.message
  }
  open.value = true
  timer = setInterval(async () => {
    if (status.value?.cooldownRemainingSec > 0) await refresh()
  }, 1000)
}

function close() {
  open.value = false
  clearInterval(timer)
}
onUnmounted(() => clearInterval(timer))

async function claim() {
  error.value = ''
  try {
    const res = await api('/relief', { method: 'POST' })
    auth.setBalance(res.balance)
    done.value = true
  } catch (e) {
    error.value = e.message
  }
}
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @click.self="close">
      <div class="w-full max-w-md rounded-2xl border border-red-500/40 bg-emerald-950 p-6">
        <h2 class="text-lg font-bold text-red-400">⚠️ 파산 구제 신청</h2>
        <div v-if="status" class="mt-4 space-y-2 text-sm text-emerald-200">
          <p>지금까지 <b class="text-red-400">{{ status.netLoss.toLocaleString() }}칩</b>을 잃었고,
            <b class="text-red-400">{{ status.bankruptCount }}번</b> 파산했습니다.</p>
          <p class="rounded bg-red-950/50 p-3 text-xs text-red-300">
            가상머니라도 이 손실 패턴은 실제 도박과 동일합니다. 실제 도박이었다면 이 돈은 돌아오지 않습니다.
            도박은 오락이 아닌 손실이며, 중독은 질병입니다.
          </p>
          <p v-if="status.cooldownRemainingSec > 0" class="text-amber-300">
            쿨다운: {{ status.cooldownRemainingSec }}초 후 신청 가능
          </p>
          <p v-else-if="!status.eligible" class="text-amber-300">{{ status.reasonIfNot }}</p>
        </div>
        <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
        <p v-if="done" class="mt-2 text-sm text-amber-300">{{ status.amount.toLocaleString() }}칩이 지급되었습니다.</p>
        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm text-emerald-300 hover:text-amber-300" @click="close">닫기</button>
          <button v-if="!done" :disabled="!status?.eligible"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40"
            @click="claim">위험을 이해했으며 {{ status?.amount?.toLocaleString() }}칩 구제받기</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
