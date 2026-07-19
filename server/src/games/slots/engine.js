import { randomInt } from 'node:crypto'

export const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7']

export const REEL = [
  ...Array(8).fill('🍒'),
  ...Array(6).fill('🍋'),
  ...Array(4).fill('🔔'),
  ...Array(2).fill('⭐'),
  '7',
]

export const PAYTABLE = [
  { match: ['7', '7', '7'], label: '잭팟! + 50배', multiplier: 50, jackpot: true },
  { match: ['⭐', '⭐', '⭐'], label: '별 3개 25배', multiplier: 25 },
  { match: ['🔔', '🔔', '🔔'], label: '종 3개 10배', multiplier: 10 },
  { match: ['🍋', '🍋', '🍋'], label: '레몬 3개 5배', multiplier: 5 },
  { match: ['🍒', '🍒', '🍒'], label: '체리 3개 3배', multiplier: 3 },
  { match: ['🍒', '🍒', '*'], label: '체리 2개 1배', multiplier: 1 },
]

// rng는 테스트 결정성 주입 seam. 미주입 시 CSPRNG(crypto.randomInt)로 편향 없이 릴을 뽑는다.
export function spin(rng = null) {
  return [0, 1, 2].map(() =>
    REEL[rng ? Math.floor(rng() * REEL.length) : randomInt(0, REEL.length)]
  )
}

export function evaluate(symbols, bet) {
  for (const row of PAYTABLE) {
    const hit = row.match.every((m, i) => m === '*' || m === symbols[i])
    if (hit) {
      return { multiplier: row.multiplier, payout: bet * row.multiplier, isJackpot: !!row.jackpot, label: row.label }
    }
  }
  return { multiplier: 0, payout: 0, isJackpot: false, label: null }
}
