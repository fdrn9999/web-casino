export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export function colorOf(n) {
  if (n === 0) return 'green'
  return RED.has(n) ? 'red' : 'black'
}

const OUTSIDE = {
  red: (n) => n > 0 && RED.has(n),
  black: (n) => n > 0 && !RED.has(n),
  odd: (n) => n > 0 && n % 2 === 1,
  even: (n) => n > 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19 && n <= 36,
  dozen1: (n) => n >= 1 && n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25 && n <= 36,
  col1: (n) => n > 0 && n % 3 === 1,
  col2: (n) => n > 0 && n % 3 === 2,
  col3: (n) => n > 0 && n % 3 === 0,
}

const OUTSIDE_MULT = {
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  dozen1: 2, dozen2: 2, dozen3: 2, col1: 2, col2: 2, col3: 2,
}

export const OUTSIDE_TYPES = Object.keys(OUTSIDE)

const INSIDE_SIZES = [1, 2, 3, 4, 6]

export function validateBet({ type, numbers } = {}) {
  if (type === 'inside') {
    if (!Array.isArray(numbers) || !INSIDE_SIZES.includes(numbers.length)) {
      return '인사이드 베팅은 번호 1·2·3·4·6개만 가능합니다.'
    }
    if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 36)) return '번호는 0~36이어야 합니다.'
    if (new Set(numbers).size !== numbers.length) return '중복된 번호가 있습니다.'
    return null
  }
  if (!OUTSIDE_TYPES.includes(type)) return '알 수 없는 베팅 종류입니다.'
  return null
}

export function spinResult(rng = Math.random) {
  return Math.floor(rng() * 37)
}

export function betPayout({ type, numbers }, amount, result) {
  if (type === 'inside') {
    return numbers.includes(result) ? Math.floor((amount * 36) / numbers.length) : 0
  }
  return OUTSIDE[type](result) ? amount * (OUTSIDE_MULT[type] + 1) : 0
}
