import type { IPairing } from './draws'
import type { ISwissPair, ISwissSide } from './swiss'

// A saved pair with each player's points going into the round.
export interface IRevealPair {
  white: ISwissSide
  black: ISwissSide | null
}

// The stored pairs carry names only; the points come from the players the round was drawn from.
export function revealPairs(pairs: IPairing[], explained: ISwissPair[]): IRevealPair[] {
  const sides = new Map<string, ISwissSide>()
  for (const pair of explained) {
    sides.set(nameKey(pair.whitePlayer.name), pair.whitePlayer)
    if (pair.blackPlayer) {
      sides.set(nameKey(pair.blackPlayer.name), pair.blackPlayer)
    }
  }

  function side(name: string): ISwissSide {
    return sides.get(nameKey(name)) ?? { name, points: 0, gameWins: 0 }
  }

  return pairs.map((pair) => ({ white: side(pair.white), black: pair.black ? side(pair.black) : null }))
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}
