<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { sfx } from '../composables/useSound'

const props = defineProps({
  game: { type: Object, required: true }, // useGameSocket 인스턴스 (onChat/sendChat)
})

const MAX_MESSAGES = 50
const messages = ref([])
const text = ref('')
const error = ref('')
const sending = ref(false)
const collapsed = ref(true) // 모바일 기본 접힘, 데스크톱은 항상 펼침(lg:flex)
const listEl = ref(null)
let offChat = null

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

onMounted(() => {
  offChat = props.game.onChat((msg) => {
    messages.value.push(msg)
    if (messages.value.length > MAX_MESSAGES) messages.value.splice(0, messages.value.length - MAX_MESSAGES)
    scrollToBottom()
  })
})
onUnmounted(() => offChat?.())

function formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

async function submit() {
  const trimmed = text.value.trim()
  if (!trimmed || sending.value) return
  error.value = ''
  sending.value = true
  sfx.click()
  try {
    const res = await props.game.sendChat(trimmed)
    if (res?.error) error.value = res.error
    else text.value = ''
  } catch {
    error.value = '메시지를 보낼 수 없습니다.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="lg:fixed lg:right-3 lg:top-20 lg:bottom-24 lg:z-30 lg:w-72">
    <div class="rounded-2xl border border-amber-500/30 bg-emerald-950/95 shadow-lg backdrop-blur lg:flex lg:h-full lg:flex-col">
      <button type="button"
        class="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-xs font-bold text-amber-300"
        @click="collapsed = !collapsed">
        <span>💬 테이블 채팅</span>
        <span class="text-emerald-400 lg:hidden">{{ collapsed ? '펼치기 ▲' : '접기 ▼' }}</span>
      </button>
      <div :class="[collapsed ? 'hidden lg:flex' : 'flex', 'flex-col border-t border-emerald-800/60 lg:min-h-0 lg:flex-1']">
        <div ref="listEl" class="max-h-56 space-y-1 overflow-y-auto px-3 py-2 text-xs lg:max-h-none lg:flex-1">
          <p v-if="messages.length === 0" class="text-emerald-500">아직 메시지가 없습니다.</p>
          <p v-for="(msg, i) in messages" :key="i" class="break-words text-emerald-200">
            <span class="text-[10px] text-emerald-600">{{ formatTime(msg.at) }}</span>
            <span class="font-bold text-amber-300">{{ msg.nickname }}</span>
            <span class="text-emerald-500">:</span>
            {{ msg.text }}
          </p>
        </div>
        <form class="flex items-center gap-1 border-t border-emerald-800/60 p-2" @submit.prevent="submit">
          <input v-model="text" type="text" maxlength="200" placeholder="메시지 입력…"
            class="min-w-0 flex-1 rounded-lg border border-emerald-700 bg-emerald-900/60 px-2 py-1.5 text-xs text-emerald-100 placeholder:text-emerald-600 focus:border-amber-400 focus:outline-none" />
          <button type="submit" :disabled="!text.trim() || sending"
            class="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-emerald-950 hover:bg-amber-400 disabled:opacity-40">
            전송</button>
        </form>
        <p v-if="error" class="px-2 pb-1.5 text-[10px] text-red-400">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
