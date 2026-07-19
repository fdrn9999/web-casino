import { Router } from 'express'
import { applyTransaction } from '../services/wallet.js'
import { getSettings } from '../services/settings.js'
import { requireAuth } from '../middleware/auth.js'
import { kstDateString } from '../lib/time.js'

export function economyRouter(db) {
  const r = Router()
  r.use(requireAuth(db))

  r.post('/bonus/daily', (req, res) => {
    const today = kstDateString()
    const row = db.prepare('SELECT last_daily_bonus_at FROM users WHERE id = ?').get(req.user.id)
    if (row.last_daily_bonus_at === today) {
      return res.status(409).json({ error: '오늘은 이미 출석 보너스를 받았습니다.' })
    }
    const { dailyBonus } = getSettings(db, 'economy')
    db.prepare('UPDATE users SET last_daily_bonus_at = ? WHERE id = ?').run(today, req.user.id)
    const { balanceAfter } = applyTransaction(db, {
      userId: req.user.id, type: 'daily_bonus', amount: dailyBonus, reason: `출석 보너스 ${today}`,
    })
    res.json({ balance: balanceAfter, amount: dailyBonus })
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
    if (row.balance >= eco.reliefThreshold) reasonIfNot = `잔액이 ${eco.reliefThreshold}칩 이상이면 구제를 받을 수 없습니다.`
    else if (cooldownRemainingSec > 0) reasonIfNot = '쿨다운이 끝나지 않았습니다.'
    return {
      eligible: !reasonIfNot,
      reasonIfNot,
      cooldownRemainingSec,
      netLoss,
      bankruptCount: row.bankrupt_count,
      amount: eco.reliefAmount,
      balance: row.balance,
    }
  }

  r.get('/relief/status', (req, res) => res.json(reliefStatus(db, req.user)))

  r.post('/relief', (req, res) => {
    const st = reliefStatus(db, req.user)
    if (!st.eligible) {
      const code = st.cooldownRemainingSec > 0 && st.balance < getSettings(db, 'economy').reliefThreshold ? 429 : 400
      return res.status(code).json({ error: st.reasonIfNot })
    }
    db.prepare("UPDATE users SET last_relief_at = datetime('now'), bankrupt_count = bankrupt_count + 1 WHERE id = ?")
      .run(req.user.id)
    const { balanceAfter } = applyTransaction(db, {
      userId: req.user.id, type: 'bankrupt_relief', amount: st.amount, reason: '파산 구제',
    })
    res.json({ balance: balanceAfter, amount: st.amount, bankruptCount: st.bankruptCount + 1 })
  })

  return r
}
