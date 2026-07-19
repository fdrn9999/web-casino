import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { getDb } from './db/index.js'
import { ensureAdmin } from './services/bootstrap.js'
import { createSocketServer } from './sockets/index.js'

const db = getDb()
ensureAdmin(db)

const app = createApp(db)
const httpServer = createServer(app)
export const io = createSocketServer(httpServer, db)

const port = process.env.PORT || 4000
httpServer.listen(port, () => console.log(`베가스 서버 기동: http://localhost:${port}`))
