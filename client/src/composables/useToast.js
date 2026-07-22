import { ref } from 'vue'

// 전역 토스트 스토어. 네이티브 alert()(블로킹 모달)를 대체한다.
// alert은 브라우저를 멈추고 이후 이벤트를 막으므로, 게임 중 안내는 항상 이 논블로킹 토스트를 쓴다.
let seq = 0
const toasts = ref([])

export function pushToast(message, { type = 'info', timeout = 3500 } = {}) {
  const id = ++seq
  toasts.value.push({ id, message, type })
  if (timeout > 0) {
    setTimeout(() => dismissToast(id), timeout)
  }
  return id
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// 편의 API — toast.error('...') 형태로 호출.
export const toast = {
  info: (m, o) => pushToast(m, { ...o, type: 'info' }),
  success: (m, o) => pushToast(m, { ...o, type: 'success' }),
  error: (m, o) => pushToast(m, { ...o, type: 'error' }),
}

export function useToast() {
  return { toasts, pushToast, dismissToast }
}
