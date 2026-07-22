<script setup>
// 바카라 Pixi 래퍼 — 뷰의 공개 미러(revealedPlayer/Banker)와 상태 스트림을 씬에 연결한다.
// 공개 타이밍·사운드는 뷰가 담당, 씬은 표시만(이중 재생 없음).
import { onUnmounted, shallowRef, watch } from 'vue'
import PixiStage from './PixiStage.vue'
import { BaccaratScene } from './scenes/BaccaratScene'

const props = defineProps({
  getState: { type: Function, required: true },
  subscribe: { type: Function, required: true },
  getPlayerCards: { type: Function, required: true },
  getBankerCards: { type: Function, required: true },
})

const scene = shallowRef(null)
let off = null
let stops = []

function makeScene(ctx) {
  scene.value = new BaccaratScene(ctx)
  return scene.value
}

function handleReady() {
  const cur = props.getState()
  if (cur) scene.value?.onState(cur)
  // 진행 중 라운드는 애니메이션 없이 스냅
  scene.value?.setCards('player', props.getPlayerCards(), { animate: false })
  scene.value?.setCards('banker', props.getBankerCards(), { animate: false })
  off = props.subscribe((s) => scene.value?.onState(s))
  stops = [
    watch(props.getPlayerCards, (cards) => scene.value?.setCards('player', cards)),
    watch(props.getBankerCards, (cards) => scene.value?.setCards('banker', cards)),
  ]
}

onUnmounted(() => {
  off?.()
  off = null
  stops.forEach((stop) => stop())
  stops = []
})
</script>

<template>
  <PixiStage :scene-factory="makeScene" @ready="handleReady" />
</template>
