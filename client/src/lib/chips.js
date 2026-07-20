// 카지노 칩 공통 설정 — 색상/표기/유틸. CasinoChip, ChipTray 및 각 게임 뷰에서 공유.
export const CHIP_VALUES = [100, 500, 1000, 5000, 10000, 50000]

// 100(회색/흰), 500(빨강), 1000(파랑/청록), 5000(초록), 10000(보라/골드), 50000(검정/골드)
export const CHIP_STYLES = {
  100: { base: '#f4f4f5', edge: '#a1a1aa', ring: '#71717a', text: '#27272a', label: '100' },
  500: { base: '#dc2626', edge: '#7f1d1d', ring: '#fecaca', text: '#ffffff', label: '500' },
  1000: { base: '#0e7490', edge: '#155e75', ring: '#a5f3fc', text: '#ffffff', label: '1K' },
  5000: { base: '#16a34a', edge: '#14532d', ring: '#bbf7d0', text: '#ffffff', label: '5K' },
  10000: { base: '#7c3aed', edge: '#4c1d95', ring: '#d4af37', text: '#fde68a', label: '10K' },
  50000: { base: '#18181b', edge: '#000000', ring: '#d4af37', text: '#eab308', label: '50K' },
}

/** 임의 금액(누적 베팅 등)에 대해 가장 근접한(이하) 액면 스타일을 고른다. */
export function chipStyleFor(value) {
  let chosen = CHIP_STYLES[100]
  for (const v of CHIP_VALUES) {
    if (value >= v) chosen = CHIP_STYLES[v]
  }
  return chosen
}

/** 칩 표면에 표시할 짧은 라벨. 정확한 액면가는 지정된 라벨(100/500/1K/5K/10K/50K)을 쓰고,
 * 임의 누적 금액은 축약 표기(예: 1600 -> 1.6K)로 가독성을 확보한다. */
export function formatChipLabel(value) {
  if (CHIP_STYLES[value]) return CHIP_STYLES[value].label
  if (value >= 1000) {
    const k = value / 1000
    const rounded = Number.isInteger(k) ? k : Math.round(k * 10) / 10
    return `${rounded}K`
  }
  return String(value)
}
