import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listTables } from '../services/tables.js'

export function tablesRouter(db) {
  const r = Router()
  r.get('/', requireAuth(db), (req, res) => res.json({ tables: listTables(db) }))
  return r
}
