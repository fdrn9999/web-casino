<script setup>
// 블랙잭 Pixi 렌더러 래퍼 — PixiStage + BlackjackScene을 묶고 소켓 스트림을 씬에 연결한다.
// 이 컴포넌트는 BlackjackView에서 async import되므로, pixi.js 번들은 그래픽 모드를 켠 유저만 내려받는다.
import { onUnmounted, shallowRef } from 'vue'
import PixiStage from './PixiStage.vue'
import { BlackjackScene } from './scenes/BlackjackScene'

const props = defineProps({
  // 현재 스냅샷 getter(진행 중 라운드 시드용)와 onState 구독 함수(해제 함수 반환)
  getState: { type: Function, required: true },
  subscribe: { type: Function, required: true },
  myUserId: { type: [Number, String], default: null },
  onSit: { type: Function, default: () => {} },
})

const scene = shallowRef(null)
let off = null

function makeScene(ctx) {
  scene.value = new BlackjackScene(ctx, { myUserId: props.myUserId, onSit: props.onSit })
  return scene.value
}

// PixiStage가 build/layout까지 끝낸 뒤(ready) 시드 + 구독을 시작한다.
function handleReady() {
  const cur = props.getState()
  if (cur) scene.value?.onState(cur)
  off = props.subscribe((s) => scene.value?.onState(s))
}

onUnmounted(() => {
  off?.()
  off = null
})
</script>

<template>
  <PixiStage :scene-factory="makeScene" @ready="handleReady" />
</template>
