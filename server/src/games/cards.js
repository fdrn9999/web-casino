import { randomInt } from 'node:crypto'

export const SUITS = ['S', 'H', 'D', 'C']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// rng는 테스트 결정성을 위한 주입 seam. 미주입 시 CSPRNG(crypto.randomInt)로
// 편향 없는 균등 셔플을 사용한다(예측 불가). 프로덕션 경로는 Math.random으로 폴백하지 않는다.
export function buildShoe(deckCount, rng = null) {
  const shoe = []
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, code: rank + suit })
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = rng ? Math.floor(rng() * (i + 1)) : randomInt(0, i + 1)
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

export function drawCard(shoe) {
  return shoe.pop()
}
