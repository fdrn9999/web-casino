<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login({ username: username.value, password: password.value })
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-amber-500/20 bg-emerald-900/60 p-6 shadow-xl">
    <h1 class="mb-1 text-center text-2xl font-bold text-amber-400">🎰 베가스</h1>
    <p class="mb-6 text-center text-xs text-emerald-300">가상머니 전용 라이브 카지노</p>
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="username">아이디</label>
        <input id="username" v-model="username" autocomplete="username"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="password">비밀번호</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button :disabled="loading"
        class="w-full rounded-lg bg-amber-500 py-2 font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-50">
        {{ loading ? '로그인 중...' : '로그인' }}
      </button>
    </form>
    <p class="mt-4 text-center text-sm text-emerald-300">
      계정이 없나요?
      <RouterLink to="/register" class="text-amber-400 hover:underline">회원가입</RouterLink>
    </p>
  </div>
</template>
