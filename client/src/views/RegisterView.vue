<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const form = ref({ username: '', password: '', nickname: '', agreed: false })
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.signup(form.value)
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
    <h1 class="mb-6 text-center text-2xl font-bold text-amber-400">회원가입</h1>
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="username">아이디 (영문 소문자·숫자·_ 4~20자)</label>
        <input id="username" v-model="form.username" autocomplete="username"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="password">비밀번호 (8자 이상)</label>
        <input id="password" v-model="form.password" type="password" autocomplete="new-password"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-emerald-200" for="nickname">닉네임 (12자 이내)</label>
        <input id="nickname" v-model="form.nickname"
          class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 outline-none focus:border-amber-400" />
      </div>
      <label class="flex items-start gap-2 text-xs text-emerald-200">
        <input v-model="form.agreed" type="checkbox" class="mt-0.5 accent-amber-500" />
        <span>본 사이트는 <b class="text-amber-300">가상머니 전용</b>이며 현금 거래가 일절 불가능함을 이해했습니다.
        실제 도박은 오락이 아닌 손실이며, 중독은 질병임을 확인했습니다. (필수)</span>
      </label>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button :disabled="loading"
        class="w-full rounded-lg bg-amber-500 py-2 font-bold text-emerald-950 hover:bg-amber-400 disabled:opacity-50">
        {{ loading ? '가입 중...' : '가입하고 10,000칩 받기' }}
      </button>
    </form>
    <p class="mt-4 text-center text-sm text-emerald-300">
      이미 계정이 있나요?
      <RouterLink to="/login" class="text-amber-400 hover:underline">로그인</RouterLink>
    </p>
  </div>
</template>
