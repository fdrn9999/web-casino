import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import {
  createTable, updateTable, setTableStatus, deleteTable, getTable, broadcastTables, ValidationError,
} from '../services/tables.js'
import { getRunner, removeRunner } from '../games/registry.js'

export function adminTablesRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  function handle(res, fn) {
    try {
      fn()
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message })
      throw e
    }
  }

  function stopRunnerFor(id) {
    getRunner(id)?.stop({ refund: true })
    removeRunner(id)
  }

  r.post('/', (req, res) => handle(res, () => {
    const table = createTable(db, req.body ?? {}, req.user.id)
    ctx.startRunner?.(table)
    broadcastTables(db, ctx.io)
    res.status(201).json({ table })
  }))

  r.put('/:id', (req, res) => {
    if (!getTable(db, req.params.id)) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    handle(res, () => {
      const table = updateTable(db, req.params.id, req.body ?? {})
      broadcastTables(db, ctx.io)
      res.json({ table })
    })
  })

  r.post('/:id/close', (req, res) => {
    if (!getTable(db, req.params.id)) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    stopRunnerFor(Number(req.params.id))
    setTableStatus(db, req.params.id, 'closed')
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  r.post('/:id/reopen', (req, res) => {
    const table = getTable(db, req.params.id)
    if (!table) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    if (table.status === 'open' || getRunner(Number(req.params.id))) {
      return res.status(409).json({ error: '이미 열려 있는 테이블입니다.' })
    }
    setTableStatus(db, req.params.id, 'open')
    ctx.startRunner?.(getTable(db, req.params.id))
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  r.delete('/:id', (req, res) => {
    if (!getTable(db, req.params.id)) return res.status(404).json({ error: '테이블을 찾을 수 없습니다.' })
    stopRunnerFor(Number(req.params.id))
    deleteTable(db, req.params.id)
    broadcastTables(db, ctx.io)
    res.json({ ok: true })
  })

  return r
}
