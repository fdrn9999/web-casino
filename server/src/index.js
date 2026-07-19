import 'dotenv/config'
import express from 'express'

const app = express()
app.get('/api/health', (req, res) => res.json({ ok: true }))
app.listen(process.env.PORT || 4000, () => console.log('server on :4000'))
