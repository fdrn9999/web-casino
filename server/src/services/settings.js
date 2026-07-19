export const DEFAULT_SETTINGS = {
  economy: {
    signupBonus: 10000,
    dailyBonus: 1000,
    reliefAmount: 3000,
    reliefThreshold: 100,
    reliefCooldownMin: 5,
  },
  slots: {
    minBet: 100,
    maxBet: 5000,
    betStep: 100,
    jackpotRate: 0.01,
    jackpotSeed: 50000,
  },
}

export function getSettings(db, game) {
  const row = db.prepare('SELECT settings_json FROM game_settings WHERE game = ?').get(game)
  const saved = row ? JSON.parse(row.settings_json) : {}
  return { ...(DEFAULT_SETTINGS[game] ?? {}), ...saved }
}

export function saveSettings(db, game, partial, updatedBy) {
  const merged = { ...getSettings(db, game), ...partial }
  db.prepare(
    `INSERT INTO game_settings (game, settings_json, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(game) DO UPDATE SET settings_json = excluded.settings_json,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(game, JSON.stringify(merged), updatedBy)
  return merged
}
