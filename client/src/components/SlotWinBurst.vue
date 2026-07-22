<script setup>
import { ref, onUnmounted } from 'vue'
import ConfettiBurst from './ConfettiBurst.vue'
import { useCountUp } from '../composables/useCountUp'

// 빠칭코풍 슬롯 당첨 연출 — 회전 광선 + 반짝임 + 콘페티 + 크게 튀는 금액.
// celebrate(payout, label, { big }) 로 재생. big이면 화면 플래시까지 더한다.
const show = ref(false)
const big = ref(false)
const label = ref('')
const amount = ref(0)
const confetti = ref(null)
const { display } = useCountUp(() => amount.value, { durationMs: 900 })
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
let timer = null

function celebrate(payout, lbl = 'WIN', { big: isBig = false } = {}) {
  amount.value = 0
  label.value = lbl
  big.value = isBig
  show.value = true
  requestAnimationFrame(() => (amount.value = payout))
  // 사소한 당첨이어도 요란하게 — 기본 콘페티도 넉넉히 뿌린다.
  confetti.value?.burst({ count: isBig ? 170 : 120, durationMs: isBig ? 2600 : 2100 })
  if (!reduced) {
    // 작은 당첨엔 짧은 흔들림, 큰 당첨엔 더 길게.
    document.documentElement.classList.add('fx-shake')
    setTimeout(() => document.documentElement.classList.remove('fx-shake'), isBig ? 600 : 320)
  }
  clearTimeout(timer)
  timer = setTimeout(close, isBig ? 2600 : 1900)
}
function close() {
  show.value = false
  document.documentElement.classList.remove('fx-shake')
  clearTimeout(timer)
}
onUnmounted(() => {
  clearTimeout(timer)
  document.documentElement.classList.remove('fx-shake')
})
defineExpose({ celebrate })
</script>

<template>
  <ConfettiBurst ref="confetti" />
  <Transition name="winpop">
    <div v-if="show" class="pointer-events-none fixed inset-0 z-[45] flex items-center justify-center"
      :class="big ? 'win-flash' : 'win-flash-soft'" @click="close">
      <div class="win-burst relative flex flex-col items-center" :class="{ 'is-big': big }">
        <div class="win-rays" aria-hidden="true"></div>
        <p class="win-title">🎉 {{ label }} 🎉</p>
        <p class="win-amount">+{{ display.toLocaleString() }}<span class="win-chip"> 칩</span></p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.win-burst { text-align: center; }
/* 뒤에서 도는 방사형 광선 — 빠칭코 특유의 화려한 배경 */
.win-rays {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 460px;
  height: 460px;
  transform: translate(-50%, -50%);
  border-radius: 9999px;
  background: repeating-conic-gradient(
    from 0deg,
    rgba(245, 158, 11, 0.35) 0deg 9deg,
    transparent 9deg 18deg
  );
  filter: blur(1px);
  animation: win-spin 6s linear infinite;
  opacity: 0.7;
}
.is-big .win-rays {
  width: 720px;
  height: 720px;
  background: repeating-conic-gradient(
    from 0deg,
    rgba(245, 158, 11, 0.45) 0deg 7deg,
    rgba(250, 204, 21, 0.15) 7deg 14deg
  );
  opacity: 0.9;
}
.win-title {
  position: relative;
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #fde68a;
  text-shadow: 0 0 12px rgba(245, 158, 11, 0.9), 0 2px 4px rgba(0, 0, 0, 0.6);
  animation: win-pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.win-amount {
  position: relative;
  margin-top: 0.25rem;
  font-size: 3rem;
  line-height: 1;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fbbf24;
  text-shadow: 0 0 22px rgba(251, 191, 36, 0.9), 0 3px 6px rgba(0, 0, 0, 0.7);
  animation: win-throb 0.5s ease-in-out 2;
}
.is-big .win-amount { font-size: 4.25rem; }
.win-chip { font-size: 1.5rem; }

@keyframes win-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes win-pop-in {
  from { opacity: 0; transform: scale(0.5) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes win-throb {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}

/* 당첨 시 화면 전체 금빛 플래시 — 큰 당첨은 강하게, 작은 당첨도 은은하게 번쩍 */
.win-flash { animation: win-flash-bg 0.5s ease-out 1; }
.win-flash-soft { animation: win-flash-soft-bg 0.45s ease-out 1; }
@keyframes win-flash-bg {
  0% { background: rgba(245, 158, 11, 0.4); }
  100% { background: transparent; }
}
@keyframes win-flash-soft-bg {
  0% { background: rgba(245, 158, 11, 0.18); }
  100% { background: transparent; }
}

.winpop-enter-active { transition: opacity 0.2s ease; }
.winpop-leave-active { transition: opacity 0.4s ease; }
.winpop-enter-from, .winpop-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .win-rays { animation: none; }
  .win-title, .win-amount { animation: none; }
  .win-flash, .win-flash-soft { animation: none; }
}
</style>
