# 플랜 7/7 — 이펙트 · 플레이어 경험 극대화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **이 플랜은 시각 결과물이 중심이다.** 각 태스크의 검증은 반드시 실제 브라우저에서 렌더를 관찰하고(정적 확인 금지), 어색하면 수치(duration·easing)를 조정 후 재관찰한다.

**Goal:** 플랜 1~6으로 완성된 "베가스"에 카지노다운 화려한 연출을 입힌다 — 카운트업, 플로팅 팝업, 카드 딜/플립, 슬롯 릴, 룰렛 휠, 잭팟 풀스크린 연출, 로비 앰비언트.

**Architecture:** 외부 애니메이션 라이브러리 없이 CSS keyframes + `requestAnimationFrame` + Canvas(컨페티)로 구현한다. 공용 유틸(`useCountUp`, `Confetti`, `FloatingText`, `effects.css`)을 먼저 만들고 각 화면에 적용한다. 모든 연출은 transform/opacity 위주로 GPU 가속, `prefers-reduced-motion` 존중.

**Tech Stack:** 기존과 동일 (신규 의존성 없음)

## Global Constraints

플랜 1~6의 Global Constraints 전체 적용. 추가:

- 연출은 **정보 전달을 방해하지 않는다**: 카운트업·연출 중에도 서버 스냅샷이 진실이며, 연출 종료 시 최종 값과 정확히 일치해야 한다.
- `@media (prefers-reduced-motion: reduce)`에서는 애니메이션을 최소화(카운트업 즉시 완료, 컨페티 생략).
- 애니메이션은 transform/opacity만 사용(레이아웃 트리거 속성 금지). Canvas 파티클은 최대 150개.
- 이 플랜은 기능 로직(서버·정산·소켓)을 일절 수정하지 않는다 — 클라이언트 표현 계층만.

## 물려받는 인터페이스 (변경 금지)

- 플랜 1~6의 모든 클라 컴포넌트·컴포저블. 특히 `useAuthStore.user.balance`, `useSound`(`sfx`, `playJackpot`), `CardImg`, `SlotsView`/`BlackjackView`/`RouletteView`/`BaccaratView`/`LobbyView`/`JackpotWidget`/`JackpotBanner`의 기존 구조

---

### Task 1: 공용 이펙트 기반 (effects.css · useCountUp · FloatingText · Confetti)

**Files:**
- Create: `client/src/effects.css`, `client/src/composables/useCountUp.js`, `client/src/components/FloatingText.vue`, `client/src/components/ConfettiBurst.vue`
- Modify: `client/src/main.js` (`import './effects.css'` 추가)

**Interfaces:**
- Produces:
  - `effects.css` — 전역 keyframes·유틸 클래스: `.fx-deal-in`(카드 딜 인), `.fx-flip`(플립), `.fx-glow-win`(승리 글로우), `.fx-pulse-gold`(골드 펄스), `.fx-shake`(화면 흔들림), `.fx-shimmer`(반짝임), `.fx-pop`(팝 등장)
  - `useCountUp(getTarget) → { display: Ref<number> }` — 대상 값 변경 시 이전 값→새 값을 600ms ease-out으로 카운트업. reduced-motion이면 즉시
  - `FloatingText` — `show(text, variant)` 노출(`defineExpose`). variant `'win'`(골드) / `'lose'`(레드). 텍스트가 위로 떠오르며 사라짐(1.2s), 동시 5개까지 스택
  - `ConfettiBurst` — `burst({ count = 120, durationMs = 2500 })` 노출. 풀스크린 Canvas에 금색·초록 파티클 분사 후 자동 정리

- [ ] **Step 1: effects.css 작성**

`client/src/effects.css`:
```css
@keyframes fx-deal-in {
  from { transform: translateY(-24px) rotate(-6deg); opacity: 0; }
  to { transform: translateY(0) rotate(0); opacity: 1; }
}
.fx-deal-in { animation: fx-deal-in 0.28s cubic-bezier(0.2, 0.8, 0.3, 1) both; }

@keyframes fx-flip {
  0% { transform: rotateY(90deg); }
  100% { transform: rotateY(0); }
}
.fx-flip { animation: fx-flip 0.35s ease-out both; }

@keyframes fx-glow-win {
  0%, 100% { box-shadow: 0 0 0 rgba(245, 158, 11, 0); }
  50% { box-shadow: 0 0 24px rgba(245, 158, 11, 0.9); }
}
.fx-glow-win { animation: fx-glow-win 1s ease-in-out 3; }

@keyframes fx-pulse-gold {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
.fx-pulse-gold { animation: fx-pulse-gold 1.4s ease-in-out infinite; }

@keyframes fx-shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-6px, 2px); }
  40% { transform: translate(5px, -3px); }
  60% { transform: translate(-4px, 3px); }
  80% { transform: translate(3px, -2px); }
}
.fx-shake { animation: fx-shake 0.5s linear 2; }

@keyframes fx-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.fx-shimmer {
  background-image: linear-gradient(105deg, transparent 40%, rgba(255, 235, 170, 0.35) 50%, transparent 60%);
  background-size: 200% 100%;
  animation: fx-shimmer 2.4s linear infinite;
}

@keyframes fx-pop {
  0% { transform: scale(0.6); opacity: 0; }
  70% { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
.fx-pop { animation: fx-pop 0.3s cubic-bezier(0.2, 0.8, 0.3, 1.2) both; }

@media (prefers-reduced-motion: reduce) {
  .fx-deal-in, .fx-flip, .fx-glow-win, .fx-pulse-gold, .fx-shake, .fx-shimmer, .fx-pop {
    animation: none !important;
  }
}
```

`client/src/main.js`의 `import './style.css'` 아래에 `import './effects.css'` 추가.

- [ ] **Step 2: useCountUp 작성**

`client/src/composables/useCountUp.js`:
```js
import { ref, watch } from 'vue'

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useCountUp(getTarget, { durationMs = 600 } = {}) {
  const display = ref(getTarget() ?? 0)
  let raf = null

  watch(getTarget, (target) => {
    if (target == null) return
    if (reduced) {
      display.value = target
      return
    }
    cancelAnimationFrame(raf)
    const from = display.value
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      display.value = Math.round(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })

  return { display }
}
```

- [ ] **Step 3: FloatingText 작성**

`client/src/components/FloatingText.vue`:
```vue
<script setup>
import { ref } from 'vue'

const items = ref([])
let seq = 0

function show(text, variant = 'win') {
  const id = ++seq
  items.value.push({ id, text, variant })
  if (items.value.length > 5) items.value.shift()
  setTimeout(() => {
    items.value = items.value.filter((i) => i.id !== id)
  }, 1200)
}
defineExpose({ show })
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-1/3 z-40 flex flex-col items-center gap-1">
    <TransitionGroup name="float">
      <span v-for="i in items" :key="i.id"
        class="float-item text-2xl font-black drop-shadow-lg"
        :class="i.variant === 'win' ? 'text-amber-300' : 'text-red-400'">
        {{ i.text }}
      </span>
    </TransitionGroup>
  </div>
</template>

<style scoped>
@keyframes float-up {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-56px); opacity: 0; }
}
.float-item { animation: float-up 1.2s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .float-item { animation: none; opacity: 0; }
}
</style>
```

- [ ] **Step 4: ConfettiBurst 작성**

`client/src/components/ConfettiBurst.vue`:
```vue
<script setup>
import { ref, onUnmounted } from 'vue'

const canvas = ref(null)
const active = ref(false)
let raf = null

const COLORS = ['#f59e0b', '#fbbf24', '#fde68a', '#34d399', '#ffffff']
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function burst({ count = 120, durationMs = 2500 } = {}) {
  if (reduced) return
  active.value = true
  requestAnimationFrame(() => {
    const el = canvas.value
    el.width = window.innerWidth
    el.height = window.innerHeight
    const ctx = el.getContext('2d')
    const parts = Array.from({ length: Math.min(count, 150) }, () => ({
      x: el.width / 2 + (Math.random() - 0.5) * el.width * 0.4,
      y: el.height * 0.3,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 10 - 4,
      size: Math.random() * 8 + 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }))
    const start = performance.now()
    const tick = (now) => {
      const t = now - start
      ctx.clearRect(0, 0, el.width, el.height)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.35
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0, 1 - t / durationMs)
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (t < durationMs) raf = requestAnimationFrame(tick)
      else {
        ctx.clearRect(0, 0, el.width, el.height)
        active.value = false
      }
    }
    raf = requestAnimationFrame(tick)
  })
}

onUnmounted(() => cancelAnimationFrame(raf))
defineExpose({ burst })
</script>

<template>
  <canvas v-show="active" ref="canvas" class="pointer-events-none fixed inset-0 z-50" />
</template>
```

- [ ] **Step 5: 빌드·브라우저 확인 후 Commit**

Run: `npm --prefix client run build` → 성공. `npm run dev`로 콘솔 에러 없음 확인.

```bash
git add client/src
git commit -m "feat: 이펙트 기반 유틸 (keyframes·카운트업·플로팅·컨페티)"
```

---

### Task 2: 잔액 카운트업 + 헤더·위젯 연출

**Files:**
- Modify: `client/src/App.vue`, `client/src/components/JackpotWidget.vue`, `client/src/views/LobbyView.vue`

**Interfaces:**
- Produces:
  - 헤더 잔액이 카운트업으로 변함 + 증가 시 골드 플래시/감소 시 레드 플래시(300ms)
  - `JackpotWidget` 금액 카운트업 + `fx-shimmer` 오버레이 + `fx-pulse-gold`
  - 로비 게임 카드 호버 시 떠오름(translate-y + 그림자 + 테두리 골드), `fx-pop` 등장

- [ ] **Step 1: 헤더 잔액 카운트업**

`client/src/App.vue` `<script setup>`에 추가:
```js
import { ref, watch } from 'vue'
import { useCountUp } from './composables/useCountUp'

const { display: balanceDisplay } = useCountUp(() => auth.user?.balance)
const balanceFlash = ref('')
watch(() => auth.user?.balance, (next, prev) => {
  if (prev == null || next == null) return
  balanceFlash.value = next > prev ? 'text-amber-300 scale-110' : 'text-red-400'
  setTimeout(() => (balanceFlash.value = ''), 300)
})
```
헤더의 잔액 `<span>`을 다음으로 교체:
```html
        <span class="rounded-full bg-emerald-800 px-3 py-1 text-sm font-semibold text-amber-200 transition-all duration-300"
          :class="balanceFlash">
          💰 {{ balanceDisplay.toLocaleString() }} 칩
        </span>
```

- [ ] **Step 2: 잭팟 위젯**

`client/src/components/JackpotWidget.vue` — `useCountUp` 적용(`const { display } = useCountUp(() => pool.value)` 후 템플릿에서 `display.toLocaleString()`), 최상위 `<section>`에 `relative overflow-hidden` 추가하고 내부 첫 줄에 shimmer 오버레이 추가:
```html
    <div class="fx-shimmer pointer-events-none absolute inset-0" />
```
금액 `<p>`에 `fx-pulse-gold` 클래스 추가.

- [ ] **Step 3: 로비 카드 호버**

`client/src/views/LobbyView.vue` 게임 카드의 클래스에 추가:
```
fx-pop transition-all duration-200 hover:-translate-y-1 hover:border-amber-400/60 hover:shadow-xl hover:shadow-amber-500/10
```

- [ ] **Step 4: 브라우저 관찰 후 Commit**

체크: 보너스 수령 시 잔액이 부드럽게 올라가며 골드 플래시, 잭팟 위젯 반짝임, 카드 호버 떠오름. 어색하면 duration 조정 후 재관찰.

```bash
git add client/src
git commit -m "feat: 잔액 카운트업·잭팟 위젯 shimmer·로비 호버 이펙트"
```

---

### Task 3: 카드 딜 인 · 딜러 홀카드 플립

**Files:**
- Modify: `client/src/components/CardImg.vue`, `client/src/views/BlackjackView.vue`, `client/src/views/BaccaratView.vue`

**Interfaces:**
- Produces:
  - `CardImg`에 `animate` prop(기본 true) — 마운트 시 `.fx-deal-in`. `code`가 `'BACK'` → 실제 코드로 바뀌면 `.fx-flip` 재생(딜러 홀카드 공개)
  - 블랙잭·바카라의 카드 렌더가 자동으로 이 연출을 얻음 (카드는 `:key`를 인덱스로 유지 — BACK→공개 시 같은 컴포넌트가 code만 바뀌어 플립 발동)

- [ ] **Step 1: CardImg 수정**

`client/src/components/CardImg.vue`의 `<script setup>`을 다음으로 교체:
```vue
<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  code: { type: String, required: true },
  animate: { type: Boolean, default: true },
})

const files = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' })

const RANK_NAMES = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
}
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

function srcFor(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  return (
    files[`../assets/cards/${rank}_of_${suit}2.svg`] ??
    files[`../assets/cards/${rank}_of_${suit}.svg`] ??
    null
  )
}

const flipping = ref(false)
watch(() => props.code, (next, prev) => {
  if (prev === 'BACK' && next !== 'BACK') {
    flipping.value = false
    requestAnimationFrame(() => (flipping.value = true))
  }
})
</script>
```
템플릿의 세 분기 모두에 클래스 바인딩 추가:
```html
  :class="[animate ? 'fx-deal-in' : '', flipping ? 'fx-flip' : '']"
```
(각 분기의 기존 class는 유지하고 `:class` 배열로 병기)

- [ ] **Step 2: 브라우저 관찰 후 Commit**

체크(블랙잭 한 라운드): 딜링 때 카드가 위에서 떨어지듯 등장 + 딜 사운드 싱크, 딜러 차례에 홀카드가 플립. 바카라 공개 때도 딜 인.

```bash
git add client/src
git commit -m "feat: 카드 딜 인·홀카드 플립 애니메이션"
```

---

### Task 4: 슬롯 — 세로 릴 연출 + 잭팟 풀스크린 연출

**Files:**
- Modify: `client/src/views/SlotsView.vue`
- Create: `client/src/components/JackpotCelebration.vue`

**Interfaces:**
- Produces:
  - 릴이 이모지 교체 대신 **세로로 흐르는 스트립**으로 회전(CSS transform, 릴마다 0/150/300ms 시차 정지 + 정지 시 `sfx.spinTick`)
  - 일반 당첨: 릴 컨테이너 `fx-glow-win` + `FloatingText`로 `+N칩`
  - `JackpotCelebration` — `celebrate(amount)` 노출: 풀스크린 오버레이(딤) + "💎 JACKPOT" `fx-pop` + 금액 카운트업(2s) + `ConfettiBurst` + 루트 `fx-shake` + `playJackpot()`은 기존 호출 유지. 5초 후 자동 닫힘(클릭으로 즉시 닫기)

- [ ] **Step 1: JackpotCelebration 작성**

`client/src/components/JackpotCelebration.vue`:
```vue
<script setup>
import { ref } from 'vue'
import ConfettiBurst from './ConfettiBurst.vue'
import { useCountUp } from '../composables/useCountUp'

const open = ref(false)
const amount = ref(0)
const confetti = ref(null)
const { display } = useCountUp(() => amount.value, { durationMs: 2000 })
let timer

function celebrate(value) {
  amount.value = 0
  open.value = true
  document.documentElement.classList.add('fx-shake')
  requestAnimationFrame(() => (amount.value = value))
  confetti.value?.burst({ count: 150 })
  clearTimeout(timer)
  timer = setTimeout(close, 5000)
}

function close() {
  open.value = false
  document.documentElement.classList.remove('fx-shake')
  clearTimeout(timer)
}
defineExpose({ celebrate })
</script>

<template>
  <Teleport to="body">
    <ConfettiBurst ref="confetti" />
    <div v-if="open" class="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/80" @click="close">
      <p class="fx-pop text-5xl font-black tracking-widest text-amber-400 drop-shadow-[0_0_24px_rgba(245,158,11,0.8)]">
        💎 JACKPOT 💎</p>
      <p class="mt-4 text-4xl font-black tabular-nums text-amber-300">{{ display.toLocaleString() }} 칩</p>
      <p class="mt-6 text-xs text-emerald-400">화면을 클릭하면 닫힙니다</p>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: SlotsView 릴 개선**

`client/src/views/SlotsView.vue` 수정:

`<script setup>`에 추가:
```js
import FloatingText from '../components/FloatingText.vue'
import JackpotCelebration from '../components/JackpotCelebration.vue'

const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7']
const floating = ref(null)
const celebration = ref(null)
const stopped = ref([true, true, true]) // 릴별 정지 여부
const glow = ref(false)
```

`doSpin`을 다음으로 교체(릴 시차 정지·연출 훅 포함):
```js
async function doSpin() {
  if (spinning.value) return
  error.value = ''
  result.value = null
  glow.value = false
  spinning.value = true
  stopped.value = [false, false, false]
  sfx.spinStart()
  try {
    const res = await api('/slots/spin', { method: 'POST', body: { bet: bet.value } })
    // 릴별 시차 정지: 900ms / 1050ms / 1200ms
    ;[0, 1, 2].forEach((i) => {
      setTimeout(() => {
        stopped.value[i] = true
        reels.value[i] = res.symbols[i]
        sfx.spinTick()
        if (i === 2) {
          result.value = res
          auth.setBalance(res.balance)
          if (res.jackpotWon) {
            playJackpot()
            celebration.value.celebrate(res.jackpotAmount)
          } else if (res.payout > 0) {
            sfx.win()
            glow.value = true
            floating.value.show(`+${res.payout.toLocaleString()}칩`, 'win')
            setTimeout(() => (glow.value = false), 3000)
          } else {
            sfx.lose()
          }
          spinning.value = false
        }
      }, 900 + i * 150)
    })
  } catch (e) {
    stopped.value = [true, true, true]
    error.value = e.message
    spinning.value = false
  }
}
```

템플릿 — 릴 영역을 다음으로 교체(세로 스트립):
```html
      <div class="relative flex justify-center gap-3" :class="glow ? 'fx-glow-win rounded-xl' : ''">
        <FloatingText ref="floating" />
        <div v-for="(s, i) in reels" :key="i"
          class="relative h-24 w-20 overflow-hidden rounded-xl bg-emerald-950 shadow-inner sm:h-28 sm:w-24">
          <div v-if="!stopped[i]" class="reel-strip absolute inset-x-0 flex flex-col items-center text-5xl leading-[6rem] sm:leading-[7rem]">
            <span v-for="(sym, k) in [...SYMBOLS, ...SYMBOLS]" :key="k">{{ sym }}</span>
          </div>
          <div v-else class="fx-pop flex h-full items-center justify-center text-5xl">{{ s }}</div>
        </div>
      </div>
```
컴포넌트 하단(최상위 div 안 아무 곳)에 `<JackpotCelebration ref="celebration" />` 추가.

`<style scoped>` 추가:
```css
@keyframes reel-scroll {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
.reel-strip { animation: reel-scroll 0.35s linear infinite; }
@media (prefers-reduced-motion: reduce) { .reel-strip { animation-duration: 2s; } }
```
기존 `setInterval` 기반 ticker 코드(reels 무작위 교체·`clearInterval`)는 제거.

- [ ] **Step 3: 브라우저 관찰 후 Commit**

체크: 스핀 시 릴이 세로로 흐르고 왼쪽부터 차례로 멈춤(틱 사운드), 당첨 시 글로우+플로팅, (rng 임시 조작으로) 잭팟 시 풀스크린 연출+컨페티+흔들림+mp3 동시. 조작 원복 확인.

```bash
git add client/src
git commit -m "feat: 슬롯 세로 릴·잭팟 풀스크린 연출"
```

---

### Task 5: 룰렛 휠 연출 + 블랙잭/바카라 결과 연출

**Files:**
- Modify: `client/src/views/RouletteView.vue`, `client/src/views/BlackjackView.vue`, `client/src/views/BaccaratView.vue`

**Interfaces:**
- Produces:
  - 룰렛: 숫자 롤링을 **회전 휠**로 교체 — 유러피언 휠 순서로 숫자 링을 그리고(conic-gradient 세그먼트 + 회전 포인터), spinning 동안 CSS 회전 가속→감속으로 **서버 결과 번호에 정확히 정지**. 결과 번호 셀 `fx-glow-win`
  - 블랙잭: 결과 페이즈에 승리 핸드 좌석 `fx-glow-win` + `FloatingText`(+지급액/패배), 내 턴 좌석 `fx-pulse-gold` 링
  - 바카라: 승리 사이드 카드 영역 `fx-glow-win`, 결과 배너 `fx-pop`, 내 베팅 결과 `FloatingText`

- [ ] **Step 1: 룰렛 휠**

`client/src/views/RouletteView.vue` 수정:

`<script setup>` — 롤링 로직(`rolling`, `startRolling`, `rollTimer`)을 제거하고 휠 로직으로 교체:
```js
// 유러피언 휠 실제 배치 순서
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const SEG = 360 / WHEEL_ORDER.length
const wheelDeg = ref(0)
const wheelSpinning = ref(false)

function spinWheelTo(resultNumber, durationMs) {
  const idx = WHEEL_ORDER.indexOf(resultNumber)
  // 포인터(12시)에 결과 세그먼트가 오도록: 5바퀴 + 목표 각도
  const target = 360 * 5 + (360 - idx * SEG)
  wheelSpinning.value = true
  wheelDeg.value = wheelDeg.value % 360 // 리셋
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wheelDeg.value += target
    })
  })
  sfx.spinStart()
  setTimeout(() => (wheelSpinning.value = false), durationMs)
}
```
`onState` 내 spinning 분기를 교체:
```js
    if (s.phase === 'spinning' && state.value?.phase !== 'spinning') {
      spinWheelTo(s.result, (s.rules.spinSeconds - 0.5) * 1000)
    }
```
(result 분기의 `clearInterval(rollTimer)`/`rolling.value = null` 줄은 제거)

템플릿 — 결과/휠 섹션의 롤링 div를 휠로 교체:
```html
      <div class="relative mx-auto h-44 w-44 sm:h-52 sm:w-52">
        <div class="absolute left-1/2 top-0 z-10 -translate-x-1/2 text-amber-400">▼</div>
        <div class="h-full w-full rounded-full border-4 border-amber-500/60"
          :style="{
            transform: `rotate(${wheelDeg}deg)`,
            transition: wheelSpinning ? `transform ${(state.rules.spinSeconds - 0.5)}s cubic-bezier(0.15, 0.6, 0.15, 1)` : 'none',
          }">
          <div v-for="(n, i) in WHEEL_ORDER" :key="n"
            class="absolute left-1/2 top-1/2 origin-top-left text-[9px] font-bold sm:text-[10px]"
            :style="{ transform: `rotate(${i * SEG - 90}deg) translateX(64px) rotate(90deg)` }"
            :class="n === 0 ? 'text-emerald-400' : RED.has(n) ? 'text-red-400' : 'text-neutral-300'">
            {{ n }}
          </div>
        </div>
        <div v-if="state.phase === 'result' && state.result !== null"
          class="fx-pop absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-white"
          :class="colorClass(state.result)">{{ state.result }}</div>
      </div>
```
번호판에서 결과 번호 셀에 `fx-glow-win` 바인딩 추가 — 번호 버튼 `:class` 배열에:
```js
state.phase === 'result' && state.result === /* 해당 번호 */ ? 'fx-glow-win' : ''
```

- [ ] **Step 2: 블랙잭 결과 연출**

`client/src/views/BlackjackView.vue`:
- `import FloatingText from '../components/FloatingText.vue'` + `const floating = ref(null)`, 템플릿 딜러 섹션 위에 `<div class="relative"><FloatingText ref="floating" /></div>` 추가
- onState의 result 진입 분기에서 사운드 재생 직후 추가:
```js
      if (mine?.bet > 0) {
        const total = mine.hands.reduce((sum, h) => sum + (h.result?.payout ?? 0), 0)
        floating.value?.show(total > 0 ? `+${total.toLocaleString()}칩` : '아쉽네요…', total > 0 ? 'win' : 'lose')
      }
```
- 좌석 div `:class`에 추가: 결과 페이즈에 승리 핸드 보유 좌석이면 `'fx-glow-win'`, 내 턴이면 기존 amber 링 대신 `'border-amber-400 bg-amber-500/10 fx-pulse-gold'`:
```js
state.phase === 'result' && seat?.hands.some((h) => h.result && h.result.payout > 0) ? 'fx-glow-win' : ''
```

- [ ] **Step 3: 바카라 결과 연출**

`client/src/views/BaccaratView.vue`:
- `FloatingText` 추가(플레이어/뱅커 카드 섹션을 `relative`로 감싸고 내부에 배치)
- 결과 배너 `<p>`에 `fx-pop` 클래스 추가
- 플레이어/뱅커 카드 영역 div `:class`에: `state.phase === 'result' && state.result?.outcome === 'player'`(뱅커는 'banker')면 `'fx-glow-win'`
- onState result 진입 시 내 베팅 존재하면 `floating.value?.show(...)` — 내 베팅 kind가 승리 항목이면 win, 아니면 lose:
```js
      const myKinds = s.bets.filter((b) => b.nickname === auth.user?.nickname).map((b) => b.kind)
      if (myKinds.length) {
        const won = myKinds.includes(s.result.outcome)
          || (myKinds.includes('ppair') && s.result.playerPair)
          || (myKinds.includes('bpair') && s.result.bankerPair)
        floating.value?.show(won ? '적중!' : '아쉽네요…', won ? 'win' : 'lose')
        ;(won ? sfx.win : sfx.lose)()
      }
```
(기존의 무조건 `sfx.win()` 호출은 이 분기로 대체)

- [ ] **Step 4: 브라우저 관찰 후 Commit**

체크: 룰렛 휠이 감속하며 정확히 결과 번호에 포인터 정렬(3라운드 반복 확인), 블랙잭 승리 좌석 글로우+플로팅, 바카라 승리 사이드 글로우·배너 팝.

```bash
git add client/src
git commit -m "feat: 룰렛 휠·블랙잭/바카라 결과 연출"
```

---

### Task 6: 최종 폴리시 검증 (전 화면 이펙트 스윕)

- [ ] **Step 1: 회귀 확인**

Run: `npm --prefix server test` → PASS (90 tests — 서버 무변경 확인)
Run: `npm --prefix client run build` → 성공

- [ ] **Step 2: 브라우저 스윕 (dev, 2창)**

1. 로비: 카드 팝 등장·호버 떠오름, 잭팟 위젯 shimmer·펄스·카운트업
2. 잔액: 보너스/베팅/당첨마다 카운트업+플래시가 모든 화면에서 동작
3. 슬롯: 릴 연출·당첨 글로우·잭팟 풀스크린(임시 rng, 원복 확인)
4. 블랙잭: 딜 인·홀카드 플립·내 턴 펄스·승리 글로우·플로팅
5. 룰렛: 휠 감속 정지 정확도(결과 번호=포인터), 결과 셀 글로우
6. 바카라: 공개 딜 인·승리 사이드 글로우·배너 팝
7. OS "동작 줄이기(reduced motion)" 켜고: 컨페티 생략·카운트업 즉시 등 성능 저하 없이 정보 동일
8. 모바일 뷰(375px): 모든 연출이 레이아웃을 깨지 않고 60fps 체감(개발자도구 Performance 한 번 녹화로 롱태스크 없는지 확인)

Expected: 전 항목 통과. 어색한 연출은 duration/easing 조정 후 재관찰.

- [ ] **Step 3: 마무리 Commit**

```bash
git add -A
git commit -m "chore: 플랜 7 완료 — 이펙트·플레이어 경험 폴리시 검증 통과"
```
