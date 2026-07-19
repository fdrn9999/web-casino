import { describe, it, expect } from 'vitest'
import { cardPoint, handTotal, playRound, betPayout } from '../src/games/baccarat/engine.js'

const c = (rank) => ({ rank, suit: 'S', code: rank + 'S' })
// playRound는 shoe.pop()으로 뽑으므로 배열의 "뒤에서부터" 나간다.
// 뽑는 순서: P1, P2, B1, B2, (P3), (B3)
function shoeFor(cardsInDrawOrder) {
  return [...cardsInDrawOrder].reverse()
}
const rules = { tiePayout: 8, pairPayout: 11 }

describe('baccarat engine', () => {
  it('카드 값: A=1, 10/그림=0, 합은 mod 10', () => {
    expect(cardPoint(c('A'))).toBe(1)
    expect(cardPoint(c('10'))).toBe(0)
    expect(cardPoint(c('K'))).toBe(0)
    expect(handTotal([c('7'), c('8')])).toBe(5)
  })

  it('내추럴 8/9면 추가 드로우 없음', () => {
    const r = playRound(shoeFor([c('4'), c('4'), c('10'), c('9')])) // P=8, B=9
    expect(r.player.length).toBe(2)
    expect(r.banker.length).toBe(2)
    expect(r.outcome).toBe('banker')
  })

  it('플레이어 5 이하면 드로우, 뱅커는 3번째 카드 규칙 적용 (B=6, P3=7 → 뱅커 드로우)', () => {
    // P: 2+3=5 → 드로우 7 → 12→2. B: 10+6=6, P3=7 → 6은 6·7에 드로우
    const r = playRound(shoeFor([c('2'), c('3'), c('10'), c('6'), c('7'), c('2')]))
    expect(r.player.length).toBe(3)
    expect(r.banker.length).toBe(3)
    expect(r.playerTotal).toBe(2)
    expect(r.bankerTotal).toBe(8)
    expect(r.outcome).toBe('banker')
  })

  it('뱅커 3, 플레이어 3번째가 8이면 뱅커 스탠드', () => {
    // P: 2+2=4 → 드로우 8 → 12→2. B: 10+3=3, P3=8 → 스탠드
    const r = playRound(shoeFor([c('2'), c('2'), c('10'), c('3'), c('8')]))
    expect(r.banker.length).toBe(2)
    expect(r.outcome).toBe('banker') // 3 > 2
  })

  it('페어 감지', () => {
    const r = playRound(shoeFor([c('4'), c('4'), c('9'), c('K')])) // P페어, P=8 내추럴
    expect(r.playerPair).toBe(true)
    expect(r.bankerPair).toBe(false)
  })

  it('배당: 플레이어 2×, 뱅커 1.95×, 타이 9×, 페어 12×, 타이 시 메인 푸시', () => {
    const win = { outcome: 'player', playerPair: false, bankerPair: true }
    expect(betPayout({ kind: 'player', amount: 100 }, win, rules)).toBe(200)
    expect(betPayout({ kind: 'banker', amount: 100 }, win, rules)).toBe(0)
    expect(betPayout({ kind: 'bpair', amount: 100 }, win, rules)).toBe(1200)
    const banker = { outcome: 'banker', playerPair: false, bankerPair: false }
    expect(betPayout({ kind: 'banker', amount: 100 }, banker, rules)).toBe(195)
    const tie = { outcome: 'tie', playerPair: false, bankerPair: false }
    expect(betPayout({ kind: 'tie', amount: 100 }, tie, rules)).toBe(900)
    expect(betPayout({ kind: 'player', amount: 100 }, tie, rules)).toBe(100)
    expect(betPayout({ kind: 'banker', amount: 100 }, tie, rules)).toBe(100)
  })
})
