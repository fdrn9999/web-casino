import { describe, it, expect } from 'vitest'
import { buildShoe, drawCard, RANKS, SUITS } from '../src/games/cards.js'

describe('cards', () => {
  it('슈는 덱수×52장이고 각 카드가 덱수만큼 있다', () => {
    const shoe = buildShoe(6)
    expect(shoe.length).toBe(312)
    const asCount = shoe.filter((c) => c.code === 'AS').length
    expect(asCount).toBe(6)
  })

  it('rng 주입 시 셔플이 결정적이다', () => {
    const rng = () => 0.5
    const a = buildShoe(1, rng).map((c) => c.code)
    const b = buildShoe(1, rng).map((c) => c.code)
    expect(a).toEqual(b)
  })

  it('drawCard는 마지막 카드를 꺼낸다', () => {
    const shoe = buildShoe(1)
    const before = shoe.length
    const card = drawCard(shoe)
    expect(shoe.length).toBe(before - 1)
    expect(RANKS).toContain(card.rank)
    expect(SUITS).toContain(card.suit)
  })
})
