const runners = new Map()

export function registerRunner(tableId, runner) {
  runners.set(Number(tableId), runner)
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
