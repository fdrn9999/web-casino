import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { requireAuth } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

class AlreadyClaimedError extends Error {}
class NotEligibleError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

function isUniqueConstraintError(e) {
  return typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')
}

export function economyRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.post('/bonus/daily', (req, res) => {
    const today = kstDateString()
    try {
      const result = db.transaction(() => {
        const row = db.prepare('SELECT last_daily_bonus_at FROM users WHERE id = ?').get(req.user.id)
        if (row.last_daily_bonus_at === today) {
          throw new AlreadyClaimedError('오늘은 이미 출석 보너스를 받았습니다.')
        }
        // 날짜 기준 UNIQUE 제약으로 당일 중복 지급을 DB 레벨에서 원자적으로 차단.
        try {
          db.prepare('INSERT INTO daily_claims (user_id, claim_type, claim_date) VALUES (?, ?, ?)')
            .run(req.user.id, 'daily_bonus', today)
        } catch (e) {
          if (isUniqueConstraintError(e)) throw new AlreadyClaimedError('오늘은 이미 출석 보너스를 받았습니다.')
          throw e
        }
        const { dailyBonus } = getSettings(db, 'economy')
        db.prepare('UPDATE users SET last_daily_bonus_at = ? WHERE id = ?').run(today, req.user.id)
        const { balanceAfter } = applyTransaction(db, {
          userId: req.user.id, type: 'daily_bonus', amount: dailyBonus, reason: `출석 보너스 ${today}`,
        })
        return { balance: balanceAfter, amount: dailyBonus }
      })()
      res.json(result)
    } catch (e) {
      if (e instanceof AlreadyClaimedError) return res.status(409).json({ error: e.message })
      throw e
    }
  })

  function reliefStatus(db, user) {
    const eco = getSettings(db, 'economy')
    const row = db.prepare('SELECT balance, last_relief_at, bankrupt_count, total_wagered, total_won FROM users WHERE id = ?').get(user.id)
    const netLoss = Math.max(0, row.total_wagered - row.total_won)
    let cooldownRemainingSec = 0
    if (row.last_relief_at) {
      const elapsed = (Date.now() - new Date(row.last_relief_at + 'Z').getTime()) / 1000
      cooldownRemainingSec = Math.max(0, Math.ceil(eco.reliefCooldownMin * 60 - elapsed))
    }
    let reasonIfNot = null
    let code = null
    if (row.balance >= eco.reliefThreshold) {
      reasonIfNot = `잔액이 ${eco.reliefThreshold}칩 이상이면 구제를 받을 수 없습니다.`
      code = 400
    } else if (cooldownRemainingSec > 0) {
      reasonIfNot = '쿨다운이 끝나지 않았습니다.'
      code = 429
    }
    return {
      eligible: !reasonIfNot,
      reasonIfNot,
      code,
      cooldownRemainingSec,
      netLoss,
      bankruptCount: row.bankrupt_count,
      amount: eco.reliefAmount,
      balance: row.balance,
      threshold: eco.reliefThreshold,
    }
  }

  r.get('/relief/status', (req, res) => res.json(reliefStatus(db, req.user)))

  r.post('/relief', (req, res) => {
    try {
      const result = db.transaction(() => {
        // 트랜잭션 내부에서 자격을 재확인해 체크-후-쓰기 사이의 경합을 방어한다.
        const st = reliefStatus(db, req.user)
        if (!st.eligible) {
          throw new NotEligibleError(st.reasonIfNot, st.code)
        }
        db.prepare("UPDATE users SET last_relief_at = datetime('now'), bankrupt_count = bankrupt_count + 1 WHERE id = ?")
          .run(req.user.id)
        const { balanceAfter } = applyTransaction(db, {
          userId: req.user.id, type: 'bankrupt_relief', amount: st.amount, reason: '파산 구제',
        })
        return { balance: balanceAfter, amount: st.amount, bankruptCount: st.bankruptCount + 1 }
      })()
      res.json(result)
    } catch (e) {
      if (e instanceof NotEligibleError) return res.status(e.code).json({ error: e.message })
      throw e
    }
  })

  return r
}
