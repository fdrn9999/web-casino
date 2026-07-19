export const SUITS = ['S', 'H', 'D', 'C']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function buildShoe(deckCount, rng = Math.random) {
  const shoe = []
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, code: rank + suit })
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

export function drawCard(shoe) {
  return shoe.pop()
}
