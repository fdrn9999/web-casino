import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../services/settings.js'

const RANGES = {
  decks: { min: 1, max: 8, integer: true },
  jackpotRate: { min: 0, max: 0.2 },
  blackjackPayout: { min: 1, max: 2 },
}

export function adminSettingsRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  r.use('/:game', (req, res, next) => {
    if (!DEFAULT_SETTINGS[req.params.game]) return res.status(404).json({ error: '없는 설정 그룹입니다.' })
    next()
  })

  r.get('/:game', (req, res) => res.json({ settings: getSettings(db, req.params.game) }))

  r.put('/:game', (req, res) => {
    const game = req.params.game
    const defaults = DEFAULT_SETTINGS[game]
    const partial = req.body ?? {}

    for (const [key, value] of Object.entries(partial)) {
      if (!(key in defaults)) return res.status(400).json({ error: `알 수 없는 설정 키: ${key}` })
      const def = defaults[key]
      if (typeof def === 'boolean') {
        if (typeof value !== 'boolean') return res.status(400).json({ error: `${key}는 켬/끔 값이어야 합니다.` })
      } else {
        if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
          return res.status(400).json({ error: `${key}는 0 이상의 숫자여야 합니다.` })
        }
        const range = RANGES[key]
        if (range) {
          if (range.integer && !Number.isInteger(value)) return res.status(400).json({ error: `${key}는 정수여야 합니다.` })
          if (value < range.min || value > range.max) {
            return res.status(400).json({ error: `${key}는 ${range.min}~${range.max} 범위여야 합니다.` })
          }
        }
      }
    }

    const merged = { ...getSettings(db, game), ...partial }
    if ('minBet' in merged && 'maxBet' in merged && merged.minBet >= merged.maxBet) {
      return res.status(400).json({ error: '최소 베팅은 최대 베팅보다 작아야 합니다.' })
    }

    const settings = saveSettings(db, game, partial, req.user.id)
    ctx.io?.emit('settings:updated', { game })
    res.json({ settings })
  })

  return r
}
