<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api'
import { onNotice } from '../composables/useSocket'

const notices = ref([])
const toast = ref(null)
const expanded = ref(null)
let off

async function load() {
  notices.value = (await api('/notices')).notices
}

onMounted(() => {
  load()
  off = onNotice((n) => {
    toast.value = n
    setTimeout(() => (toast.value = null), 3000)
    load()
  })
})
onUnmounted(() => off?.())
</script>

<template>
  <section class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4">
    <div v-if="toast" class="mb-3 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-emerald-950">
      📢 새 공지: {{ toast.title }}
    </div>
    <h2 class="mb-2 text-sm font-bold text-amber-300">📢 공지사항</h2>
    <p v-if="notices.length === 0" class="text-xs text-emerald-400">등록된 공지가 없습니다.</p>
    <ul class="space-y-1">
      <li v-for="n in notices" :key="n.id">
        <button class="w-full text-left text-sm text-emerald-200 hover:text-amber-300"
          @click="expanded = expanded === n.id ? null : n.id">
          <span v-if="n.pinned" class="mr-1 text-amber-400">📌</span>{{ n.title }}
          <span class="ml-2 text-xs text-emerald-500">{{ n.created_at?.slice(0, 10) }}</span>
        </button>
        <p v-if="expanded === n.id" class="mt-1 whitespace-pre-wrap rounded bg-emerald-950/60 p-2 text-xs text-emerald-300">
          {{ n.body }}
        </p>
      </li>
    </ul>
  </section>
</template>
