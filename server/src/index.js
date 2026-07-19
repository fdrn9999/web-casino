import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { getDb } from './db/index.js'
import { ensureAdmin } from './services/bootstrap.js'
import { createSocketServer } from './sockets/index.js'
import { ensureJackpot } from './services/jackpot.js'
import { getSettings } from './services/settings.js'
import { startRunner, startAllOpenTables } from './games/index.js'

const db = getDb()
ensureAdmin(db)
ensureJackpot(db, getSettings(db, 'slots').jackpotSeed)

const ctx = {}
const app = createApp(db, ctx)
const httpServer = createServer(app)
ctx.io = createSocketServer(httpServer, db)
export const io = ctx.io
ctx.startRunner = (table) => startRunner(db, ctx.io, table)
startAllOpenTables(db, ctx.io)

const port = process.env.PORT || 4000
httpServer.listen(port, () => console.log(`베가스 서버 기동: http://localhost:${port}`))
