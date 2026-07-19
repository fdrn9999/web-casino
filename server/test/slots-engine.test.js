import { describe, it, expect } from 'vitest'
import { spin, evaluate, REEL } from '../src/games/slots/engine.js'

function rngFor(indexes) {
  let i = 0
  return () => indexes[i++] / REEL.length
}

describe('slots engine', () => {
  it('rng 주입으로 결과가 결정적이다', () => {
    const idx7 = REEL.indexOf('7')
    const symbols = spin(rngFor([idx7, idx7, idx7]))
    expect(symbols).toEqual(['7', '7', '7'])
  })

  it('7 3개는 잭팟 + 50배', () => {
    const r = evaluate(['7', '7', '7'], 100)
    expect(r.isJackpot).toBe(true)
    expect(r.payout).toBe(5000)
  })

  it('체리 2개(앞 2릴)는 1배', () => {
    expect(evaluate(['🍒', '🍒', '🔔'], 200).payout).toBe(200)
  })

  it('체리 3개는 3배 (2개 규칙에 우선)', () => {
    expect(evaluate(['🍒', '🍒', '🍒'], 100).payout).toBe(300)
  })

  it('무일치는 0', () => {
    const r = evaluate(['🍒', '🔔', '⭐'], 100)
    expect(r.payout).toBe(0)
    expect(r.isJackpot).toBe(false)
  })
})
