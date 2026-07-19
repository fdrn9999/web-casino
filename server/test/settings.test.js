import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'
import { getSettings, saveSettings } from '../src/services/settings.js'

describe('settings', () => {
  it('저장된 값이 없으면 기본값을 반환한다', () => {
    const db = createDb()
    expect(getSettings(db, 'economy').signupBonus).toBe(10000)
  })

  it('저장하면 기본값 위에 머지되어 반환된다', () => {
    const db = createDb()
    saveSettings(db, 'economy', { signupBonus: 5000 }, null)
    const s = getSettings(db, 'economy')
    expect(s.signupBonus).toBe(5000)
    expect(s.dailyBonus).toBe(1000)
  })
})
