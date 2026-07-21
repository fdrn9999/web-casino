<script setup>
import { computed, ref, watch, onMounted } from 'vue'

const props = defineProps({
  code: { type: String, required: true },
  // 마운트 시 기본 딜 연출(페이드/슬라이드) 재생 여부 — 기존 호출부(바카라 등) 호환용.
  animate: { type: Boolean, default: true },
  // 블랙잭 전용: 슈에서 날아와 뒷면->앞면으로 뒤집히는 연출. 기본 false로 두어 다른 게임(바카라)의
  // 기존 동작은 그대로 유지하고, 블랙잭 화면에서만 명시적으로 켠다.
  dealAnimate: { type: Boolean, default: false },
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

const src = computed(() => (props.code === 'BACK' ? null : srcFor(props.code)))

const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// revealed: 지금 앞면(실카드)을 보여줘야 하면 true, 뒷면을 보여줘야 하면 false.
// - dealAnimate 카드가 처음 마운트될 때: 잠깐 뒷면 상태로 슈에서 날아온 뒤 스스로 뒤집어 공개한다
//   (identity는 이미 서버가 보낸 값 그대로이며, 오직 "언제 보여줄지"만 늦추는 연출임).
// - 화면에 이미 떠 있던 BACK 카드가 실카드로 교체되는 경우(딜러 홀카드 오픈): 그 즉시 뒤집는다.
const revealed = ref(props.dealAnimate && !prefersReduced ? false : props.code !== 'BACK')

onMounted(() => {
  if (!props.dealAnimate || prefersReduced) return
  if (props.code === 'BACK') return // 아직 공개 안 된 카드 — 서버가 실카드를 보내줄 때(watch)까지 대기
  // 슈에서 날아오는 이동 연출이 끝날 즈음 스스로 뒤집어 공개한다
  setTimeout(() => {
    revealed.value = true
  }, 260)
})

// 이미 마운트된 카드의 code가 'BACK' -> 실카드로 바뀌면(딜러 홀카드 공개) 즉시 뒤집는다.
watch(() => props.code, (next, prev) => {
  if (prev === 'BACK' && next !== 'BACK') {
    revealed.value = true
  }
})
</script>

<template>
  <div
    class="card-outer relative aspect-[5/7] w-12 sm:w-16"
    :class="dealAnimate && !prefersReduced ? 'card-shoe-travel' : (animate ? 'fx-deal-in' : '')"
  >
    <div class="card-flip-inner" :class="{ 'is-revealed': revealed }">
      <div class="card-face card-face-back" aria-hidden="true" title="뒤집힌 카드" />
      <img v-if="src" :src="src" :alt="code" class="card-face card-face-front object-contain" />
      <div v-else class="card-face card-face-front flex items-center justify-center bg-white text-xs font-bold text-black">
        {{ code === 'BACK' ? '' : code }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 3D 카드 플립: 부모(card-outer)가 perspective를 주고, 자식(card-flip-inner)이 실제로 회전한다.
   앞/뒤 두 면을 모두 렌더링해두고 backface-visibility:hidden으로 뒤에 있는 면을 감춘다. */
.card-outer {
  perspective: 900px;
}
.card-flip-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.42s cubic-bezier(0.3, 0.1, 0.2, 1);
}
.card-flip-inner.is-revealed {
  transform: rotateY(180deg);
}
.card-face {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 0.375rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.card-face-back {
  transform: rotateY(0deg);
  background: linear-gradient(160deg, #7f1d1d, #450a0a);
  border: 2px solid rgba(255, 255, 255, 0.8);
  background-image:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 6px, transparent 6px 12px),
    linear-gradient(160deg, #7f1d1d, #450a0a);
}
.card-face-front {
  transform: rotateY(180deg);
  background: #fff;
}

/* 슈에서 날아오는 딜 이동 연출: 우측 상단(슈 위치 방향)에서 축소+회전된 상태로 시작해 제자리로 안착 */
@keyframes fx-shoe-travel {
  from { transform: translate(58px, -46px) scale(0.55) rotate(12deg); opacity: 0; }
  to { transform: translate(0, 0) scale(1) rotate(0); opacity: 1; }
}
.card-shoe-travel {
  animation: fx-shoe-travel 0.3s cubic-bezier(0.2, 0.75, 0.3, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .card-flip-inner { transition: none !important; }
  .card-shoe-travel { animation: none !important; }
}
</style>
