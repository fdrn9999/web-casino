import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { authRouter } from './routes/auth.js'
import { economyRouter } from './routes/economy.js'
import { adminUsersRouter } from './routes/admin-users.js'
import { noticesRouter, adminNoticesRouter } from './routes/notices.js'
import { slotsRouter } from './routes/slots.js'
import { tablesRouter } from './routes/tables.js'
import { adminTablesRouter } from './routes/admin-tables.js'
import { adminSettingsRouter } from './routes/admin-settings.js'
import { adminStatsRouter } from './routes/admin-stats.js'
import { meStatsRouter } from './routes/me-stats.js'
import { attendanceRouter } from './routes/attendance.js'
import { leaderboardRouter } from './routes/leaderboard.js'
import { requireAuth } from './middleware/auth.js'

export function createApp(db, ctx = {}) {
  const app = express()
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter(db))
  app.use('/api/me/stats', meStatsRouter(db))
  app.get('/api/me', requireAuth(db), (req, res) => res.json({ user: req.user }))
  app.use('/api/admin/users', adminUsersRouter(db, ctx))
  app.use('/api/notices', noticesRouter(db))
  app.use('/api/admin/notices', adminNoticesRouter(db, ctx))
  app.use('/api', economyRouter(db))
  app.use('/api/slots', slotsRouter(db))
  app.use('/api/tables', tablesRouter(db))
  app.use('/api/admin/tables', adminTablesRouter(db, ctx))
  app.use('/api/admin/settings', adminSettingsRouter(db, ctx))
  app.use('/api/admin/stats', adminStatsRouter(db))
  app.use('/api/attendance', attendanceRouter(db))
  app.use('/api/leaderboard', leaderboardRouter(db))

  app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }))

  // 모듈 위치(server/src) 기준으로 해석해 실행 cwd와 무관하게 client/dist를 찾는다.
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url))
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
        return res.sendFile(path.join(dist, 'index.html'))
      }
      next()
    })
  }

  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: '서버 오류가 발생했습니다.' })
  })
  return app
}
