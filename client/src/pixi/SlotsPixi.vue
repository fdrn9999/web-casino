<script setup>
// 슬롯 Pixi 래퍼 — 뷰의 릴 상태를 매 프레임 읽어 씬이 미러링한다(로직·사운드는 뷰 담당).
import { shallowRef } from 'vue'
import PixiStage from './PixiStage.vue'
import { SlotsScene } from './scenes/SlotsScene'

const props = defineProps({
  // getFrame(): { strips, y, states, suspense, glow }
  getFrame: { type: Function, required: true },
})

const scene = shallowRef(null)

function makeScene(ctx) {
  scene.value = new SlotsScene(ctx, { getFrame: props.getFrame })
  return scene.value
}
</script>

<template>
  <PixiStage :scene-factory="makeScene" background="#065f46" />
</template>
