import { getRunner } from '../games/registry.js'

export const GAME_KEYS = ['blackjack', 'roulette', 'baccarat']

export class ValidationError extends Error {}

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

function validate({ game, name, limits }) {
  if (!GAME_KEYS.includes(game)) throw new ValidationError('지원하지 않는 게임입니다.')
  if (name !== undefined && name !== null && typeof name !== 'string') throw new ValidationError('테이블 이름은 문자열이어야 합니다.')
  if (!name?.trim() || name.trim().length > 20) throw new ValidationError('테이블 이름은 1~20자여야 합니다.')
  if (limits != null) {
    const { minBet, maxBet } = limits
    if (!Number.isInteger(minBet) || !Number.isInteger(maxBet) || minBet < 1 || minBet >= maxBet) {
      throw new ValidationError('베팅 한도는 양의 정수이며 최소 < 최대여야 합니다.')
    }
  }
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
