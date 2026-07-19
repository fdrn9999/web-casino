import express from 'express'
import { authRouter } from './routes/auth.js'
import { economyRouter } from './routes/economy.js'
import { requireAuth } from './middleware/auth.js'

export function createApp(db, ctx = {}) {
  const app = express()
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter(db))
  app.get('/api/me', requireAuth(db), (req, res) => res.json({ user: req.user }))
  app.use('/api', economyRouter(db))

  app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }))
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: '서버 오류가 발생했습니다.' })
  })
  return app
}
