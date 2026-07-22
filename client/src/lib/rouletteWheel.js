// 유러피언 룰렛 휠 공통 상수 — DOM 뷰(RouletteView)와 Pixi 씬(RouletteScene)이 공유한다.
// 한 곳만 수정하면 두 렌더러가 항상 같은 휠을 그린다.
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]
export const SEG = 360 / WHEEL_ORDER.length

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export function pocketHex(n) {
  return n === 0 ? '#059669' : RED_NUMBERS.has(n) ? '#b91c1c' : '#171717'
}
