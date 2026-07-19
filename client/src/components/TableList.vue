<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { onTablesUpdate } from '../composables/useSocket'

const props = defineProps({ game: { type: String, required: true } })
const all = ref([])
let off

const tables = computed(() => all.value.filter((t) => t.game === props.game && t.status === 'open'))

onMounted(async () => {
  all.value = (await api('/tables')).tables
  off = onTablesUpdate(({ tables: t }) => (all.value = t))
})
onUnmounted(() => off?.())
</script>

<template>
  <div class="mt-2 space-y-1">
    <p v-if="tables.length === 0" class="text-xs text-emerald-500">관리자가 테이블을 준비 중입니다.</p>
    <RouterLink v-for="t in tables" :key="t.id" :to="`/${game}/${t.id}`"
      class="flex items-center justify-between rounded-lg bg-emerald-950/60 px-3 py-2 text-xs hover:bg-emerald-800/60">
      <span class="font-bold text-emerald-100">{{ t.name }}</span>
      <span class="text-emerald-400">
        👥 {{ t.playerCount }}<template v-if="t.limits"> · {{ t.limits.minBet }}~{{ t.limits.maxBet }}칩</template>
      </span>
    </RouterLink>
  </div>
</template>
