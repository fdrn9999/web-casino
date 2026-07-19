import bcrypt from 'bcryptjs'

export function ensureAdmin(db) {
  const existing = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()
  if (existing) return
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin1234'
  db.prepare("INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, '운영자', 'admin')")
    .run(username, bcrypt.hashSync(password, 10))
  console.log(`[bootstrap] 관리자 계정 생성: ${username}`)
}
