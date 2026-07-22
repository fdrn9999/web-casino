// 카드 코드("AS", "10H", "KD"...)를 텍스트 표기(랭크+수트기호)로 변환하는 순수 유틸.
// 그래픽(CardImg)이 쓰는 것과 동일한 서버 카드 데이터에서 파생되므로, 항상 그래픽과 일치한다.
// 절대 카드를 새로 만들어내지 않는다 — 여기 들어오는 code는 항상 서버가 보낸 값(또는 'BACK')이어야 한다.

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' }
const RED_SUITS = new Set(['H', 'D'])

/**
 * @param {string} code 예: "AS", "10H", "KD", 또는 아직 공개되지 않은 카드는 "BACK"
 * @returns {{ rank: string, suit: string, symbol: string, isRed: boolean, hidden: boolean }}
 */
export function cardRankSuit(code) {
  if (!code || code === 'BACK') {
    return { rank: '', suit: '', symbol: '', isRed: false, hidden: true }
  }
  const suit = code.slice(-1)
  const rank = code.slice(0, -1)
  return { rank, suit, symbol: SUIT_SYMBOL[suit] ?? suit, isRed: RED_SUITS.has(suit), hidden: false }
}

// 카드 한 장의 짧은 텍스트("A♠", "10♥"). 아직 안 보이는 카드는 '?'로 표시(내용 유출 금지).
// 주의: 유니코드 플레잉카드 글리프(🂠, U+1F0A0 블록)는 Windows 한글 폰트에 없어 깨진 네모로
// 렌더링되므로 사용 금지 — 어디서나 안전한 ASCII '?'를 쓴다.
export function cardShortText(code) {
  const { rank, symbol, hidden } = cardRankSuit(code)
  return hidden ? '?' : `${rank}${symbol}`
}
