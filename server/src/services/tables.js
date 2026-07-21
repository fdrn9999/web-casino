import { getRunner } from '../games/registry.js'
import { DEFAULT_SETTINGS } from './settings.js'

export const GAME_KEYS = ['blackjack', 'roulette', 'baccarat']

export class ValidationError extends Error {}

// 게임별 방(테이블) 단위로 재정의 가능한 규칙 필드와 허용 범위.
// 여기 없는 키는 오버라이드 대상이 아니며(알 수 없는 키로 거부), 값을 지정하지 않은 필드는
// 러너가 전역 기본 규칙(settings.js DEFAULT_SETTINGS)으로 자동 병합한다.
export const GAME_RULE_FIELDS = {
  blackjack: {
    decks: { type: 'int', min: 1, max: 8 },
    hitSoft17: { type: 'bool' },
    surrenderAllowed: { type: 'bool' },
    doubleAllowed: { type: 'bool' },
    splitAllowed: { type: 'bool' },
    blackjackPayout: { type: 'number', min: 1, max: 2 },
    minBet: { type: 'int', min: 1, max: 10_000_000 },
    maxBet: { type: 'int', min: 1, max: 10_000_000 },
    betSeconds: { type: 'int', min: 5, max: 120 },
    turnSeconds: { type: 'int', min: 5, max: 120 },
  },
  roulette: {
    minBet: { type: 'int', min: 1, max: 10_000_000 },
    maxBet: { type: 'int', min: 1, max: 10_000_000 },
    betSeconds: { type: 'int', min: 5, max: 120 },
    spinSeconds: { type: 'int', min: 5, max: 120 },
  },
  baccarat: {
    minBet: { type: 'int', min: 1, max: 10_000_000 },
    maxBet: { type: 'int', min: 1, max: 10_000_000 },
    betSeconds: { type: 'int', min: 5, max: 120 },
    revealSeconds: { type: 'int', min: 5, max: 120 },
    tiePayout: { type: 'number', min: 0.01, max: 1000 },
    pairPayout: { type: 'number', min: 0.01, max: 1000 },
  },
}

function rowToTable(row) {
  return {
    id: row.id,
    game: row.game,
    name: row.name,
    status: row.status,
    limits: row.limits_json ? JSON.parse(row.limits_json) : null,
    playerCount: getRunner(row.id)?.playerCount() ?? 0,
  }
}

// 부분 규칙 오버라이드 객체를 검증한다. game은 이미 GAME_KEYS에 속함이 보장된 상태여야 함.
// 지정된 필드만 검사하고(미지정 필드는 기본값으로 병합되므로 검사 불필요), 병합 후
// 유효 최소/최대 베팅(min < max)을 확인한다.
export function validateRuleOverride(game, limits) {
  if (limits == null) return
  if (typeof limits !== 'object' || Array.isArray(limits)) {
    throw new ValidationError('규칙 오버라이드는 객체여야 합니다.')
  }
  const fields = GAME_RULE_FIELDS[game] ?? {}
  for (const [key, value] of Object.entries(limits)) {
    const spec = fields[key]
    if (!spec) throw new ValidationError(`알 수 없는 규칙 키: ${key}`)
    if (spec.type === 'bool') {
      if (typeof value !== 'boolean') throw new ValidationError(`${key}는 켬/끔 값이어야 합니다.`)
      continue
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new ValidationError(`${key}는 숫자여야 합니다.`)
    }
    if (spec.type === 'int' && !Number.isInteger(value)) {
      throw new ValidationError(`${key}는 정수여야 합니다.`)
    }
    if (value < spec.min || value > spec.max) {
      throw new ValidationError(`${key}는 ${spec.min}~${spec.max} 범위여야 합니다.`)
    }
  }

  const effective = { ...(DEFAULT_SETTINGS[game] ?? {}), ...limits }
  if ('minBet' in effective && 'maxBet' in effective && !(effective.minBet < effective.maxBet)) {
    throw new ValidationError('베팅 한도는 최소 < 최대여야 합니다.')
  }
}

function validate({ game, name, limits }) {
  if (!GAME_KEYS.includes(game)) throw new ValidationError('지원하지 않는 게임입니다.')
  if (name !== undefined && name !== null && typeof name !== 'string') throw new ValidationError('테이블 이름은 문자열이어야 합니다.')
  if (!name?.trim() || name.trim().length > 20) throw new ValidationError('테이블 이름은 1~20자여야 합니다.')
  validateRuleOverride(game, limits)
}

export function listTables(db, game = null) {
  const rows = game
    ? db.prepare('SELECT * FROM tables WHERE game = ? ORDER BY id').all(game)
    : db.prepare('SELECT * FROM tables ORDER BY id').all()
  return rows.map(rowToTable)
}

export function getTable(db, id) {
  const row = db.prepare('SELECT * FROM tables WHERE id = ?').get(id)
  return row ? rowToTable(row) : null
}

export function createTable(db, { game, name, limits = null }, createdBy) {
  validate({ game, name, limits })
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO tables (game, name, limits_json, created_by) VALUES (?, ?, ?, ?)'
  ).run(game, name.trim(), limits ? JSON.stringify(limits) : null, createdBy)
  return getTable(db, id)
}

export function updateTable(db, id, { name, limits }) {
  const current = getTable(db, id)
  if (!current) throw new ValidationError('테이블을 찾을 수 없습니다.')
  const next = { game: current.game, name: name ?? current.name, limits: limits === undefined ? current.limits : limits }
  validate(next)
  db.prepare('UPDATE tables SET name = ?, limits_json = ? WHERE id = ?')
    .run(next.name.trim(), next.limits ? JSON.stringify(next.limits) : null, id)
  return getTable(db, id)
}

export function setTableStatus(db, id, status) {
  db.prepare('UPDATE tables SET status = ? WHERE id = ?').run(status, id)
}

export function deleteTable(db, id) {
  db.prepare('DELETE FROM tables WHERE id = ?').run(id)
}

export function broadcastTables(db, io) {
  io?.emit('tables:update', { tables: listTables(db) })
}
