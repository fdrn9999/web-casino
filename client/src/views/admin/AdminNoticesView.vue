<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../../lib/api'

const notices = ref([])
const form = ref({ id: null, title: '', body: '', pinned: false })
const msg = ref('')

async function load() {
  notices.value = (await api('/notices')).notices
}

function edit(n) {
  form.value = { id: n.id, title: n.title, body: n.body, pinned: !!n.pinned }
}
function reset() {
  form.value = { id: null, title: '', body: '', pinned: false }
}

async function save() {
  msg.value = ''
  try {
    const body = { title: form.value.title, body: form.value.body, pinned: form.value.pinned }
    if (form.value.id) await api(`/admin/notices/${form.value.id}`, { method: 'PUT', body })
    else await api('/admin/notices', { method: 'POST', body })
    reset()
    await load()
    msg.value = '저장되었습니다.'
  } catch (e) {
    msg.value = e.message
  }
}

async function remove(id) {
  if (!confirm('이 공지를 삭제할까요?')) return
  await api(`/admin/notices/${id}`, { method: 'DELETE' })
  await load()
}

onMounted(load)
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <form class="space-y-3 rounded-xl border border-emerald-800 bg-emerald-900/40 p-4" @submit.prevent="save">
      <h2 class="font-bold text-amber-300">{{ form.id ? '공지 수정' : '새 공지 작성' }}</h2>
      <input v-model="form.title" placeholder="제목"
        class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm" />
      <textarea v-model="form.body" rows="5" placeholder="내용"
        class="w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm"></textarea>
      <label class="flex items-center gap-2 text-sm text-emerald-200">
        <input v-model="form.pinned" type="checkbox" class="accent-amber-500" /> 상단 고정
      </label>
      <div class="flex gap-2">
        <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-amber-400">
          {{ form.id ? '수정' : '등록' }}</button>
        <button v-if="form.id" type="button" class="text-sm text-emerald-300" @click="reset">새로 작성</button>
      </div>
      <p v-if="msg" class="text-sm text-amber-300">{{ msg }}</p>
    </form>

    <ul class="space-y-2">
      <li v-for="n in notices" :key="n.id" class="rounded-xl border border-emerald-800 bg-emerald-900/40 p-3">
        <div class="flex items-center gap-2">
          <span v-if="n.pinned" class="text-amber-400">📌</span>
          <b class="text-sm">{{ n.title }}</b>
          <span class="ml-auto flex gap-2 text-xs">
            <button class="text-emerald-300 hover:text-amber-300" @click="edit(n)">수정</button>
            <button class="text-red-400 hover:text-red-300" @click="remove(n.id)">삭제</button>
          </span>
        </div>
        <p class="mt-1 whitespace-pre-wrap text-xs text-emerald-300">{{ n.body }}</p>
      </li>
    </ul>
  </div>
</template>
