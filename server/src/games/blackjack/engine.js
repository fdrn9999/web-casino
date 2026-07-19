export function handValue(cards) {
  let total = 0
  let aces = 0
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11
      aces++
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10
    } else {
      total += Number(card.rank)
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21
}

export function isBust(cards) {
  return handValue(cards).total > 21
}

export function dealerShouldHit(cards, hitSoft17) {
  const { total, soft } = handValue(cards)
  if (total < 17) return true
  if (total === 17 && soft && hitSoft17) return true
  return false
}

export function settleHand({ playerCards, dealerCards, bet, doubled = false, surrendered = false, fromSplit = false, rules }) {
  if (surrendered) return { payout: Math.floor(bet / 2), outcome: 'surrender' }
  if (isBust(playerCards)) return { payout: 0, outcome: 'bust' }

  const playerBJ = !fromSplit && isBlackjack(playerCards)
  const dealerBJ = isBlackjack(dealerCards)
  if (playerBJ && dealerBJ) return { payout: bet, outcome: 'push' }
  if (playerBJ) return { payout: bet + Math.floor(bet * rules.blackjackPayout), outcome: 'blackjack' }
  if (dealerBJ) return { payout: 0, outcome: 'lose' }

  const p = handValue(playerCards).total
  const d = handValue(dealerCards).total
  if (d > 21 || p > d) return { payout: bet * 2, outcome: 'win' }
  if (p === d) return { payout: bet, outcome: 'push' }
  return { payout: 0, outcome: 'lose' }
}
