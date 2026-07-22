import { Assets } from 'pixi.js'

// 카드 SVG를 Pixi 텍스처로 직접 로드한다(별도 아틀라스 굽기/네이티브 의존성 없이).
// CardImg.vue와 동일한 코드→파일명 매핑을 쓴다.
const files = import.meta.glob('../assets/cards/*.svg', { eager: true, query: '?url', import: 'default' })

const RANK_NAMES = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
}
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }

export function codeToFrame(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  return `${rank}_of_${suit}`
}

function urlFor(code) {
  const suit = SUIT_NAMES[code.slice(-1)]
  const rank = RANK_NAMES[code.slice(0, -1)]
  if (!suit || !rank) return null
  return (
    files[`../assets/cards/${rank}_of_${suit}2.svg`] ??
    files[`../assets/cards/${rank}_of_${suit}.svg`] ??
    null
  )
}

const cache = new Map()

// 필요한 카드 코드들의 텍스처를 미리 로드해 캐시한다(BACK 제외 — 뒷면은 Graphics로 그린다).
export async function loadCardTextures(codes) {
  const pending = []
  for (const code of new Set(codes)) {
    if (code === 'BACK' || cache.has(code)) continue
    const url = urlFor(code)
    if (!url) continue
    pending.push(
      Assets.load(url).then((tex) => cache.set(code, tex)).catch(() => {})
    )
  }
  await Promise.all(pending)
}

// 덱 전체(52장) 코드 목록 — 데모/사전로드용.
export function fullDeckCodes() {
  const codes = []
  for (const s of ['S', 'H', 'D', 'C']) {
    for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
      codes.push(`${r}${s}`)
    }
  }
  return codes
}

export function cardTexture(code) {
  return cache.get(code) ?? null
}
