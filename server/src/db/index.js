import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  bankrupt_count INTEGER NOT NULL DEFAULT 0,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  last_daily_bonus_at TEXT,
  last_relief_at TEXT,
  attendance_streak INTEGER NOT NULL DEFAULT 0,
  last_attendance TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  game TEXT,
  ref_round_id INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  limits_json TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  table_id INTEGER REFERENCES tables(id),
  result_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  bet_json TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payout INTEGER
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS game_settings (
  game TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jackpot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pool INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  last_winner_id INTEGER REFERENCES users(id),
  last_won_amount INTEGER,
  last_won_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_claims (
  user_id INTEGER NOT NULL REFERENCES users(id),
  claim_type TEXT NOT NULL,
  claim_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, claim_type, claim_date)
);
`

export function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
  if (!cols.includes('attendance_streak')) db.exec("ALTER TABLE users ADD COLUMN attendance_streak INTEGER NOT NULL DEFAULT 0")
  if (!cols.includes('last_attendance')) db.exec("ALTER TABLE users ADD COLUMN last_attendance TEXT")
}

export function createDb(filename = ':memory:') {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

let instance = null
export function getDb() {
  if (!instance) {
    const file = process.env.DB_PATH || 'data/casino.db'
    fs.mkdirSync(path.dirname(file), { recursive: true })
    instance = createDb(file)
  }
  return instance
}
