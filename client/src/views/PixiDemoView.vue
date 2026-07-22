<script setup>
// PixiJS 렌더링 전환 Phase A 검증용 데모 화면.
// PixiStage(엔진) + DemoScene(펠트·슈·카드 딜·플립·칩)이 실제 브라우저에서 동작함을 확인한다.
// 실제 게임 뷰(블랙잭 등)는 건드리지 않으며, DOM 렌더러와 별개의 독립 페이지다.
import { useRouter } from 'vue-router'
import PixiStage from '../pixi/PixiStage.vue'
import { DemoScene } from '../pixi/scenes/DemoScene'

const router = useRouter()
function makeScene(ctx) {
  return new DemoScene(ctx)
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-3">
    <div class="flex items-center gap-2">
      <h1 class="text-lg font-bold text-amber-400">🧪 PixiJS 렌더 데모 (Phase A)</h1>
      <button class="ml-auto text-sm text-emerald-300 hover:text-amber-300" @click="router.push('/')">로비로</button>
    </div>
    <p class="text-xs text-emerald-400/80">
      게임 렌더링을 PixiJS(WebGL)로 전환하기 위한 기반 검증 페이지입니다. 실제 카드 SVG를 텍스처로 로드해
      슈에서 카드가 날아오고 뒤집히며, 칩이 액면별로 쌓입니다. 4초마다 반복 딜합니다.
    </p>
    <div class="pixi-frame">
      <PixiStage :scene-factory="makeScene" />
    </div>
  </div>
</template>

<style scoped>
.pixi-frame {
  position: relative;
  width: 100%;
  height: 520px;
  border-radius: 1rem;
  overflow: hidden;
  border: 1px solid rgba(180, 83, 9, 0.4);
}
</style>
