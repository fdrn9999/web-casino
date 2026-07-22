// 베팅 마감 직전 보호(전 게임 공통) — 마감 수백 ms 전의 베팅은 서버 도착 시점에 따라
// 조용히 거부되거나 의도치 않게 접수되는 레이스가 생긴다. 클라이언트에서 미리 막고 명확히 안내한다.
export const DEADLINE_GUARD_MS = 800
export const DEADLINE_GUARD_MESSAGE = '마감 직전입니다 — 다음 라운드에 베팅해 주세요.'

export function nearDeadline(state, thresholdMs = DEADLINE_GUARD_MS) {
  const endsAt = state?.phaseEndsAt
  return !!endsAt && endsAt - Date.now() < thresholdMs
}
