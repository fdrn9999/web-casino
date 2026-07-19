<script setup>
import { RouterView, RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useSound } from './composables/useSound'

const auth = useAuthStore()
const router = useRouter()
const { muted, toggleMute } = useSound()

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header
      v-if="auth.isLoggedIn"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 bg-emerald-900/80 border-b border-amber-500/30"
    >
      <RouterLink to="/" class="text-lg font-bold text-amber-400">🎰 베가스</RouterLink>
      <div class="ml-auto flex items-center gap-3">
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-sm text-amber-300 hover:underline">⚙️ 관리자</RouterLink>
        <span class="rounded-full bg-emerald-800 px-3 py-1 text-sm font-semibold text-amber-200">
          💰 {{ (auth.user?.balance ?? 0).toLocaleString() }} 칩
        </span>
        <span class="text-sm text-emerald-200">{{ auth.user?.nickname }}</span>
        <button class="text-lg" :title="muted ? '소리 켜기' : '소리 끄기'" @click="toggleMute">
          {{ muted ? '🔇' : '🔊' }}
        </button>
        <button class="text-sm text-emerald-300 hover:text-amber-300" @click="logout">로그아웃</button>
      </div>
    </header>

    <main class="flex-1 p-4">
      <RouterView />
    </main>

    <footer class="border-t border-emerald-800 px-4 py-3 text-center text-xs text-emerald-300/70">
      본 사이트는 가상머니 전용입니다. 실제 도박은 오락이 아닌 손실이며, 중독은 질병입니다.
    </footer>
  </div>
</template>
