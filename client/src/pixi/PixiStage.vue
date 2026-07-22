<script setup>
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import { Application } from 'pixi.js'
import { sfx } from '../composables/useSound'
import { makeTween, makeDelay } from './tween'

// 게임 렌더링 전환의 공용 스테이지 — Application 하나를 마운트하고 리사이즈/DPR/파괴를 관리한다.
// 씬은 한 번에 하나만 호스팅한다. 서버/소켓과 무관한 표현 계층 전용.
const props = defineProps({
  sceneFactory: { type: Function, required: true },
  background: { type: String, default: '#07422c' },
})
const emit = defineEmits(['ready', 'error'])

const hostEl = ref(null)
const app = shallowRef(null) // shallowRef: Pixi 객체는 절대 반응형으로 감싸지 않는다
const scene = shallowRef(null)
const failed = ref(false)
let destroyed = false
let ro = null

// prefers-reduced-motion을 설정 시점에 1회만 읽는다(다른 파일들과 동일 패턴).
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function buildContext(a) {
  return {
    app: a,
    stage: a.stage,
    get screen() {
      return a.screen
    },
    reducedMotion,
    sfx,
    tween: (opts) => makeTween(a, opts),
    delay: (ms, fn) => makeDelay(a, ms, fn),
  }
}

async function mountScene(a) {
  if (scene.value) {
    scene.value.destroy()
    a.stage.removeChildren()
  }
  const ctx = buildContext(a)
  const s = props.sceneFactory(ctx)
  a.stage.addChild(s.root)
  if (s.preload) await s.preload()
  if (destroyed) return
  s.build()
  s.layout(a.screen.width, a.screen.height)
  scene.value = s
}

onMounted(async () => {
  const a = new Application()
  try {
    await a.init({
      background: props.background,
      resizeTo: hostEl.value,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    })
  } catch (e) {
    failed.value = true
    emit('error', e)
    return
  }
  if (destroyed) {
    a.destroy(true, { children: true })
    return
  }
  hostEl.value.appendChild(a.canvas)
  a.canvas.setAttribute('aria-hidden', 'true') // 캔버스는 장식 — 접근성은 DOM 오버레이가 담당
  app.value = a

  await mountScene(a)
  emit('ready', buildContext(a))

  ro = new ResizeObserver(() => {
    if (!app.value) return
    const { width, height } = app.value.screen
    scene.value?.layout(width, height)
  })
  ro.observe(hostEl.value)
})

onUnmounted(() => {
  destroyed = true
  ro?.disconnect()
  ro = null
  scene.value?.destroy()
  scene.value = null
  app.value?.destroy(
    { removeView: true },
    { children: true, texture: true, textureSource: true }
  )
  app.value = null
})

defineExpose({ app, scene })
</script>

<template>
  <div ref="hostEl" class="pixi-host">
    <div v-if="failed" class="pixi-fallback">그래픽 렌더링을 사용할 수 없습니다. (WebGL 미지원)</div>
  </div>
</template>

<style scoped>
.pixi-host {
  position: relative;
  width: 100%;
  height: 100%;
}
.pixi-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6ee7b7;
  font-size: 0.875rem;
}
</style>
