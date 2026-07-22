const runners = new Map()

export function registerRunner(tableId, runner) {
  const id = Number(tableId)
  const existing = runners.get(id)
  // 이중 방어: 기존 러너가 정리되지 않은 채 새 러너로 교체되면 옛 타이머가
  // 계속 발화해 이중 정산으로 이어질 수 있으므로, 교체 전 반드시 정지시킨다.
  if (existing && existing !== runner) {
    existing.stop?.({ refund: true })
  }
  runners.set(id, runner)
}
export function getRunner(tableId) {
  return runners.get(Number(tableId))
}
export function removeRunner(tableId) {
  runners.delete(Number(tableId))
}
export function allRunners() {
  return [...runners.values()]
}
export function clearRunners() {
  runners.clear()
}
