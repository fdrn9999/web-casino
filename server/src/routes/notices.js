import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

function getNotice(db, id) {
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(id)
}

export function noticesRouter(db) {
  const r = Router()
  r.get('/', requireAuth(db), (req, res) => {
    const notices = db.prepare('SELECT * FROM notices ORDER BY pinned DESC, id DESC LIMIT 50').all()
    res.json({ notices })
  })
  return r
}

export function adminNoticesRouter(db, ctx) {
  const r = Router()
  r.use(requireAuth(db), requireAdmin)

  function validate(req, res) {
    const { title, body } = req.body ?? {}
    if (!title?.trim() || !body?.trim()) {
      res.status(400).json({ error: '제목과 내용을 모두 입력해야 합니다.' })
      return null
    }
    return { title: title.trim(), body: body.trim(), pinned: req.body.pinned ? 1 : 0 }
  }

  r.post('/', (req, res) => {
    const v = validate(req, res)
    if (!v) return
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO notices (title, body, pinned, created_by) VALUES (?, ?, ?, ?)'
    ).run(v.title, v.body, v.pinned, req.user.id)
    const notice = getNotice(db, id)
    ctx.io?.emit('notice:new', notice)
    res.status(201).json({ notice })
  })

  r.put('/:id', (req, res) => {
    if (!getNotice(db, req.params.id)) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
    const v = validate(req, res)
    if (!v) return
    db.prepare("UPDATE notices SET title = ?, body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(v.title, v.body, v.pinned, req.params.id)
    res.json({ notice: getNotice(db, req.params.id) })
  })

  r.delete('/:id', (req, res) => {
    if (!getNotice(db, req.params.id)) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
    db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  return r
}
