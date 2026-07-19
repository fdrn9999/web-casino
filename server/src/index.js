import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { getDb } from './db/index.js'
import { ensureAdmin } from './services/bootstrap.js'
import { createSocketServer } from './sockets/index.js'
import { ensureJackpot } from './services/jackpot.js'
import { getSettings } from './services/settings.js'
import { startRunner, startAllOpenTables } from './games/index.js'
import { reconcileUnfinishedRounds } from './services/reconcile.js'

process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

const db = getDb()
ensureAdmin(db)

const refunded = reconcileUnfinishedRounds(db)
if (refunded > 0) console.log(`[reconcile] 미정산 베팅 ${refunded}건 환불 완료`)

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
