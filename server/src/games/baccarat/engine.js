export const BET_KINDS = ['player', 'banker', 'tie', 'ppair', 'bpair']

export function cardPoint(card) {
  if (card.rank === 'A') return 1
  if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 0
  return Number(card.rank)
}

export function handTotal(cards) {
  return cards.reduce((sum, card) => sum + cardPoint(card), 0) % 10
}

export function playRound(shoe) {
  const draw = () => shoe.pop()
  const player = [draw(), draw()]
  const banker = [draw(), draw()]
  let playerTotal = handTotal(player)
  let bankerTotal = handTotal(banker)

  if (playerTotal < 8 && bankerTotal < 8) {
    let thirdPoint = null
    if (playerTotal <= 5) {
      player.push(draw())
      thirdPoint = cardPoint(player[2])
      playerTotal = handTotal(player)
    }
    const bankerDraws =
      thirdPoint === null
        ? bankerTotal <= 5
        : bankerTotal <= 2
          ? true
          : bankerTotal === 3
            ? thirdPoint !== 8
            : bankerTotal === 4
              ? thirdPoint >= 2 && thirdPoint <= 7
              : bankerTotal === 5
                ? thirdPoint >= 4 && thirdPoint <= 7
                : bankerTotal === 6
                  ? thirdPoint >= 6 && thirdPoint <= 7
                  : false
    if (bankerDraws) {
      banker.push(draw())
      bankerTotal = handTotal(banker)
    }
  }

  const outcome = playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie'
  return {
    player,
    banker,
    playerTotal,
    bankerTotal,
    outcome,
    playerPair: player[0].rank === player[1].rank,
    bankerPair: banker[0].rank === banker[1].rank,
  }
}

export function betPayout({ kind, amount }, result, rules) {
  switch (kind) {
    case 'player':
      if (result.outcome === 'player') return amount * 2
      return result.outcome === 'tie' ? amount : 0
    case 'banker':
      if (result.outcome === 'banker') return amount + Math.floor(amount * 0.95)
      return result.outcome === 'tie' ? amount : 0
    case 'tie':
      return result.outcome === 'tie' ? amount * (1 + rules.tiePayout) : 0
    case 'ppair':
      return result.playerPair ? amount * (1 + rules.pairPayout) : 0
    case 'bpair':
      return result.bankerPair ? amount * (1 + rules.pairPayout) : 0
    default:
      return 0
  }
}
