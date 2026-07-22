<script setup>
// 룰렛 Pixi 래퍼 — 상태 스트림을 씬에 연결한다. 스핀 사운드는 뷰가 담당(이중 재생 없음).
import { onUnmounted, shallowRef } from 'vue'
import PixiStage from './PixiStage.vue'
import { RouletteScene } from './scenes/RouletteScene'

const props = defineProps({
  getState: { type: Function, required: true },
  subscribe: { type: Function, required: true },
})

const scene = shallowRef(null)
let off = null

function makeScene(ctx) {
  scene.value = new RouletteScene(ctx)
  return scene.value
}

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
