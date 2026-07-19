import { describe, it, expect } from 'vitest'
import { colorOf, validateBet, spinResult, betPayout } from '../src/games/roulette/engine.js'

describe('roulette engine', () => {
  it('색상: 0은 그린, 1은 레드, 2는 블랙', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(2)).toBe('black')
  })

  it('인사이드 검증: 길이 1·2·3·4·6만, 범위·중복 체크', () => {
    expect(validateBet({ type: 'inside', numbers: [7] })).toBeNull()
    expect(validateBet({ type: 'inside', numbers: [1, 2, 3, 4, 5, 6] })).toBeNull()
    expect(validateBet({ type: 'inside', numbers: [1, 2, 3, 4, 5] })).toBeTruthy()
    expect(validateBet({ type: 'inside', numbers: [37] })).toBeTruthy()
    expect(validateBet({ type: 'inside', numbers: [1, 1] })).toBeTruthy()
    expect(validateBet({ type: 'nope' })).toBeTruthy()
    expect(validateBet({ type: 'red' })).toBeNull()
  })

  it('인사이드 배당: 36/n 공식', () => {
    expect(betPayout({ type: 'inside', numbers: [7] }, 100, 7)).toBe(3600)
    expect(betPayout({ type: 'inside', numbers: [7] }, 100, 8)).toBe(0)
    expect(betPayout({ type: 'inside', numbers: [1, 2, 3] }, 100, 2)).toBe(1200)
    expect(betPayout({ type: 'inside', numbers: [1, 2, 3, 4, 5, 6] }, 100, 6)).toBe(600)
  })

  it('아웃사이드 배당: 이븐머니 2배, 더즌·칼럼 3배, 0은 아웃사이드 전패', () => {
    expect(betPayout({ type: 'red' }, 100, 1)).toBe(200)
    expect(betPayout({ type: 'red' }, 100, 2)).toBe(0)
    expect(betPayout({ type: 'odd' }, 100, 9)).toBe(200)
    expect(betPayout({ type: 'low' }, 100, 18)).toBe(200)
    expect(betPayout({ type: 'high' }, 100, 19)).toBe(200)
    expect(betPayout({ type: 'dozen2' }, 100, 13)).toBe(300)
    expect(betPayout({ type: 'col1' }, 100, 4)).toBe(300)
    for (const type of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'col3']) {
      expect(betPayout({ type }, 100, 0)).toBe(0)
    }
  })

  it('spinResult는 0~36 정수', () => {
    expect(spinResult(() => 0)).toBe(0)
    expect(spinResult(() => 0.9999)).toBe(36)
  })
})
