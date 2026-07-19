<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router'
const route = useRoute()
const tabs = [
  { to: '/admin/users', label: '유저 관리' },
  { to: '/admin/notices', label: '공지 관리' },
]
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <h1 class="mb-4 text-xl font-bold text-amber-400">⚙️ 관리자</h1>
    <nav class="mb-4 flex flex-wrap gap-2 border-b border-emerald-800 pb-2">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to"
        class="rounded-lg px-3 py-1.5 text-sm"
        :class="route.path.startsWith(t.to) ? 'bg-amber-500 font-bold text-emerald-950' : 'text-emerald-300 hover:text-amber-300'">
        {{ t.label }}
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
