import { describe, it, expect } from 'vitest'
import { handValue, isBlackjack, isBust, dealerShouldHit, settleHand } from '../src/games/blackjack/engine.js'

const c = (rank) => ({ rank, suit: 'S', code: rank + 'S' })
const rules = { blackjackPayout: 1.5 }

describe('blackjack engine', () => {
  it('핸드 값: 하드/소프트/에이스 강등', () => {
    expect(handValue([c('10'), c('7')])).toEqual({ total: 17, soft: false })
    expect(handValue([c('A'), c('6')])).toEqual({ total: 17, soft: true })
    expect(handValue([c('A'), c('6'), c('10')])).toEqual({ total: 17, soft: false })
    expect(handValue([c('A'), c('A'), c('9')])).toEqual({ total: 21, soft: true })
    expect(isBust([c('10'), c('9'), c('5')])).toBe(true)
  })

  it('블랙잭 판정은 첫 2장 21만', () => {
    expect(isBlackjack([c('A'), c('K')])).toBe(true)
    expect(isBlackjack([c('7'), c('7'), c('7')])).toBe(false)
  })

  it('딜러: 16 히트, 하드17 스탠드, 소프트17은 설정에 따름', () => {
    expect(dealerShouldHit([c('10'), c('6')], false)).toBe(true)
    expect(dealerShouldHit([c('10'), c('7')], false)).toBe(false)
    expect(dealerShouldHit([c('A'), c('6')], false)).toBe(false)
    expect(dealerShouldHit([c('A'), c('6')], true)).toBe(true)
  })

  it('정산: 블랙잭 배당·승·무·패·버스트·서렌더', () => {
    const dealer17 = [c('10'), c('7')]
    expect(settleHand({ playerCards: [c('A'), c('K')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 250, outcome: 'blackjack' })
    expect(settleHand({ playerCards: [c('A'), c('K')], dealerCards: [c('A'), c('Q')], bet: 100, rules }))
      .toEqual({ payout: 100, outcome: 'push' })
    expect(settleHand({ playerCards: [c('10'), c('9')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 200, outcome: 'win' })
    expect(settleHand({ playerCards: [c('10'), c('7')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 100, outcome: 'push' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 0, outcome: 'lose' })
    expect(settleHand({ playerCards: [c('10'), c('9'), c('5')], dealerCards: dealer17, bet: 100, rules }))
      .toEqual({ payout: 0, outcome: 'bust' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: [c('10'), c('6'), c('10')], bet: 100, rules }))
      .toEqual({ payout: 200, outcome: 'win' })
    expect(settleHand({ playerCards: [c('10'), c('6')], dealerCards: dealer17, bet: 100, surrendered: true, rules }))
      .toEqual({ payout: 50, outcome: 'surrender' })
  })

  it('6:5 배당 설정 반영', () => {
    const r = settleHand({ playerCards: [c('A'), c('K')], dealerCards: [c('10'), c('7')], bet: 100, rules: { blackjackPayout: 1.2 } })
    expect(r.payout).toBe(220)
  })

  it('스플릿에서 나온 21은 블랙잭 보너스 없이 일반 21로 정산된다', () => {
    const dealer17 = [c('10'), c('7')]
    const playerCards = [c('A'), c('K')]
    // 일반 핸드(스플릿 아님): 첫 2장 21 → 블랙잭 1.5배 보너스
    expect(settleHand({ playerCards, dealerCards: dealer17, bet: 100, fromSplit: false, rules }))
      .toEqual({ payout: 250, outcome: 'blackjack' })
    // 스플릿에서 나온 21: 블랙잭 보너스 없이 21 vs 17 일반 승리(2배)로 처리
    expect(settleHand({ playerCards, dealerCards: dealer17, bet: 100, fromSplit: true, rules }))
      .toEqual({ payout: 200, outcome: 'win' })
  })
})
