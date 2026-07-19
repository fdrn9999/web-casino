import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db/index.js'

describe('db', () => {
  it('모든 테이블이 생성된다', () => {
    const db = createDb(':memory:')
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
    for (const t of ['users', 'transactions', 'tables', 'rounds', 'bets', 'notices', 'game_settings', 'jackpot']) {
      expect(names).toContain(t)
    }
  })

  it('users.username은 유니크 제약이 있다', () => {
    const db = createDb(':memory:')
    const ins = db.prepare("INSERT INTO users (username, password_hash, nickname) VALUES (?, 'h', 'n')")
    ins.run('dup')
    expect(() => ins.run('dup')).toThrow()
  })
})
