import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { signToken } from '../middleware/auth.js'

const SAFE_FIELDS = `id, username, nickname, role, balance, banned, ban_reason,
  bankrupt_count, total_wagered, total_won, created_at`

export function authRouter(db) {
  const r = Router()

  r.post('/signup', (req, res) => {
    const { username, password, nickname, agreed } = req.body ?? {}
    if (!agreed) return res.status(400).json({ error: '가상머니 전용 안내와 도박 위험성 고지에 동의해야 가입할 수 있습니다.' })
    if (!/^[a-z0-9_]{4,20}$/.test(username ?? '')) {
      return res.status(400).json({ error: '아이디는 4~20자의 영문 소문자·숫자·밑줄만 가능합니다.' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })
    }
    const nick = (nickname ?? '').trim()
    if (!nick || nick.length > 12) return res.status(400).json({ error: '닉네임은 1~12자여야 합니다.' })
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    }
    const hash = bcrypt.hashSync(password, 10)
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)')
      .run(username, hash, nick)
    const { signupBonus } = getSettings(db, 'economy')
    applyTransaction(db, { userId: Number(id), type: 'signup_bonus', amount: signupBonus, reason: '가입 축하 칩' })
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(id)
    res.status(201).json({ token: signToken(user), user })
  })

  r.post('/login', (req, res) => {
    const { username, password } = req.body ?? {}
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username ?? '')
    if (!row || !bcrypt.compareSync(password ?? '', row.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })
    }
    if (row.banned) return res.status(403).json({ error: `차단된 계정입니다. 사유: ${row.ban_reason || '미기재'}` })
    const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(row.id)
    res.json({ token: signToken(user), user })
  })

  return r
}
