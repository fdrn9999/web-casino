import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { requireAuth } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

function rewardFor(rewards, streak) {
  return rewards[Math.min(streak - 1, rewards.length - 1)]
}

class AlreadyClaimedError extends Error {}

function isUniqueConstraintError(e) {
  return typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')
}

export function attendanceRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.get('/', (req, res) => {
    const { attendanceRewards } = getSettings(db, 'economy')
    const today = kstDateString()
    const yesterday = kstDateString(new Date(Date.now() - 86400000))
    const row = db.prepare('SELECT attendance_streak, last_attendance FROM users WHERE id = ?').get(req.user.id)
    const todayClaimed = row.last_attendance === today
    const streak = row.attendance_streak
    const nextStreak = todayClaimed ? streak : (row.last_attendance === yesterday ? streak + 1 : 1)
    res.json({
      streak,
      todayClaimed,
      rewards: attendanceRewards,
      nextReward: rewardFor(attendanceRewards, nextStreak),
    })
  })

  r.post('/', (req, res) => {
    const { attendanceRewards } = getSettings(db, 'economy')
    const today = kstDateString()
    const yesterday = kstDateString(new Date(Date.now() - 86400000))
    try {
      const result = db.transaction(() => {
        const row = db.prepare('SELECT attendance_streak, last_attendance FROM users WHERE id = ?').get(req.user.id)
        if (row.last_attendance === today) {
          throw new AlreadyClaimedError('오늘은 이미 출석했습니다.')
        }
        // 날짜 기준 UNIQUE 제약(user_id, claim_type, claim_date) — 이 INSERT가 원자적으로
        // "당일 중복 지급"을 DB 레벨에서 차단하는 최종 방어선이다. 위 컬럼 기반 검사와
        // 별개로, 동시 요청이 몰려도 둘 중 하나만 성공한다.
        try {
          db.prepare('INSERT INTO daily_claims (user_id, claim_type, claim_date) VALUES (?, ?, ?)')
            .run(req.user.id, 'attendance', today)
        } catch (e) {
          if (isUniqueConstraintError(e)) throw new AlreadyClaimedError('오늘은 이미 출석했습니다.')
          throw e
        }
        const streak = row.last_attendance === yesterday ? row.attendance_streak + 1 : 1
        const reward = rewardFor(attendanceRewards, streak)
        db.prepare('UPDATE users SET last_attendance = ?, attendance_streak = ? WHERE id = ?').run(today, streak, req.user.id)
        const { balanceAfter } = applyTransaction(db, {
          userId: req.user.id, type: 'attendance', amount: reward, reason: `출석 ${streak}일차`,
        })
        return { streak, reward, balance: balanceAfter }
      })()
      res.json(result)
    } catch (e) {
      if (e instanceof AlreadyClaimedError) return res.status(409).json({ error: e.message })
      throw e
    }
  })

  return r
}
