import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import './effects.css'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'

// ── 모바일 터치 하드닝(전역) ──
// 게임에서 멀티터치를 쓰지 않으므로 두 손가락 이상은 즉시 차단해 핀치줌/의도치 않은
// 제스처를 막는다. preventDefault가 실제로 동작하려면 passive: false가 필수다.
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) e.preventDefault()
  },
  { passive: false }
)
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault()
  },
  { passive: false }
)
// iOS 사파리 전용 핀치 제스처 이벤트도 차단
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })
// 이미지·링크 등 요소가 드래그로 끌려나오는 기본 동작 차단(마우스 조작에는 영향 없음)
document.addEventListener('dragstart', (e) => e.preventDefault())

const app = createApp(App)
app.use(createPinia())

const auth = useAuthStore()
if (auth.isLoggedIn) auth.fetchMe()

app.use(router)
app.mount('#app')
