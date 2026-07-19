import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { requireAuth } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

function rewardFor(rewards, streak) {
  return rewards[Math.min(streak - 1, rewards.length - 1)]
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
    const row = db.prepare('SELECT attendance_streak, last_attendance FROM users WHERE id = ?').get(req.user.id)
    if (row.last_attendance === today) {
      return res.status(409).json({ error: '오늘은 이미 출석했습니다.' })
    }
    const streak = row.last_attendance === yesterday ? row.attendance_streak + 1 : 1
    const reward = rewardFor(attendanceRewards, streak)
    db.prepare('UPDATE users SET last_attendance = ?, attendance_streak = ? WHERE id = ?').run(today, streak, req.user.id)
    const { balanceAfter } = applyTransaction(db, {
      userId: req.user.id, type: 'attendance', amount: reward, reason: `출석 ${streak}일차`,
    })
    res.json({ streak, reward, balance: balanceAfter })
  })

  return r
}
