import { describe, it, expect } from 'vitest'
import { sanitizeMessage, RateLimiter } from '../src/games/chat.js'

describe('sanitizeMessage', () => {
  it('빈 문자열(공백 포함)은 거부한다', () => {
    const res = sanitizeMessage('   ')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('메시지를 입력하세요.')
  })

  it('200자를 초과하면 거부한다', () => {
    const res = sanitizeMessage('가'.repeat(201))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('메시지는 200자 이내여야 합니다.')
  })

  it('금칙어를 마스킹한다', () => {
    const res = sanitizeMessage('이 시발 진짜')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('이 ** 진짜')
    expect(res.text).not.toContain('시발')
  })

  it('여러 금칙어를 각각 마스킹한다', () => {
    const res = sanitizeMessage('병신 개새끼')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('** ***')
  })

  it('정상 메시지는 trim되어 통과한다', () => {
    const res = sanitizeMessage('  안녕하세요  ')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('안녕하세요')
  })
})

describe('RateLimiter', () => {
  it('첫 메시지는 허용한다', () => {
    const rl = new RateLimiter(2000)
    expect(rl.allow('u1', 1000)).toBe(true)
  })

  it('간격 내 두 번째 메시지는 거부한다', () => {
    const rl = new RateLimiter(2000)
    expect(rl.allow('u1', 1000)).toBe(true)
    expect(rl.allow('u1', 1500)).toBe(false)
  })

  it('간격이 지나면 다시 허용한다', () => {
    const rl = new RateLimiter(2000)
    expect(rl.allow('u1', 1000)).toBe(true)
    expect(rl.allow('u1', 3001)).toBe(true)
  })

  it('사용자별로 독립적으로 제한한다', () => {
    const rl = new RateLimiter(2000)
    expect(rl.allow('u1', 1000)).toBe(true)
    expect(rl.allow('u2', 1000)).toBe(true)
  })
})
