import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { requireAuth } from '../middleware/auth.js'

const BCRYPT_COST = 10 // auth.js 회원가입 경로와 동일한 비용을 사용한다.

export function meRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  // 마이페이지 - 비밀번호 변경 (본인, 로그인 필요, 현재 비밀번호 확인 필수)
  r.post('/password', (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {}
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: '현재 비밀번호를 입력해 주세요.' })
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' })
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' })
    }

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' })
    }

    const hash = bcrypt.hashSync(newPassword, BCRYPT_COST)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id)
    res.json({ ok: true })
  })

  // 마이페이지 - 베팅 기록 (최신순, 페이지네이션)
  r.get('/bets', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)

    const rows = db.prepare(`
      SELECT b.id, r.game, b.amount, b.payout, r.started_at, r.ended_at
      FROM bets b JOIN rounds r ON r.id = b.round_id
      WHERE b.user_id = ?
      ORDER BY b.id DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset)
    const { c: total } = db.prepare('SELECT COUNT(*) c FROM bets WHERE user_id = ?').get(req.user.id)

    const bets = rows.map((row) => {
      const payout = row.payout ?? 0
      const net = payout - row.amount
      return {
        id: row.id,
        game: row.game,
        amount: row.amount,
        payout,
        net,
        result: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
        created_at: row.ended_at ?? row.started_at,
      }
    })

    res.json({ bets, total, limit, offset })
  })

  return r
}
