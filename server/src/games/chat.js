const MAX_LENGTH = 200

const BANNED_WORDS = ['시발', '씨발', '개새끼', '병신']

export function sanitizeMessage(text) {
  const trimmed = String(text ?? '').trim()

  if (!trimmed) {
    return { ok: false, error: '메시지를 입력하세요.' }
  }

  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: '메시지는 200자 이내여야 합니다.' }
  }

  let masked = trimmed
  for (const word of BANNED_WORDS) {
    masked = masked.split(word).join('*'.repeat(word.length))
  }

  return { ok: true, text: masked }
}

const PRUNE_EVERY_N_CALLS = 50

export class RateLimiter {
  constructor(intervalMs = 2000) {
    this.intervalMs = intervalMs
    this.lastSentAt = new Map()
    this._callsSincePrune = 0
  }

  allow(userId, now = Date.now()) {
    this._maybePrune(now)
    const last = this.lastSentAt.get(userId)
    if (last !== undefined && now - last < this.intervalMs) {
      return false
    }
    this.lastSentAt.set(userId, now)
    return true
  }

  // Opportunistic sweep so long-lived servers don't grow this Map forever with
  // entries for users who stopped chatting. Runs every N calls, not every call,
  // to keep the common-case cost of allow() unchanged.
  _maybePrune(now) {
    this._callsSincePrune += 1
    if (this._callsSincePrune < PRUNE_EVERY_N_CALLS) return
    this._callsSincePrune = 0
    const staleAfter = this.intervalMs * 10
    for (const [userId, lastAt] of this.lastSentAt) {
      if (now - lastAt > staleAfter) this.lastSentAt.delete(userId)
    }
  }
}
