import type { IStanding } from './match-score'

export type MatchId = 'semi1' | 'semi2' | 'qualifier' | 'grand'
export interface PlayoffBracket {
  finalist: string
  seeds: [string, string, string, string]
  winners: Partial<Record<MatchId, string>>
}

export function qualification(standings: IStanding[]) {
  const finalists = standings.filter(player => player.wins === 4)
  const contenders = standings.filter(player => player.wins === 3)
  const finalist = finalists.length === 1 ? finalists[0]!.name : null
  let reason: string | null = null
  if (finalists.length > 1) reason = 'More than one player has four wins. The organizer must resolve qualification.'
  else if (!finalist) reason = 'Waiting for a player to finish with four wins.'
  else if (contenders.length !== 4) reason = `Waiting for exactly four players with three wins (${contenders.length}/4 currently).`
  else if (contenders.some(player => player.played < 4)) reason = 'The three-win players still have qualifying matches to finish.'
  return { finalist, contenders: contenders.map(player => player.name), canDraw: reason === null, reason }
}

export function matchPlayers(bracket: PlayoffBracket, match: MatchId): [string | null, string | null] {
  switch (match) {
    case 'semi1': return [bracket.seeds[0], bracket.seeds[1]]
    case 'semi2': return [bracket.seeds[2], bracket.seeds[3]]
    case 'qualifier': return [bracket.winners.semi1 ?? null, bracket.winners.semi2 ?? null]
    case 'grand': return [bracket.finalist, bracket.winners.qualifier ?? null]
  }
}

// Correcting a result clears every dependent result so no eliminated player can advance.
export function recordWinner(bracket: PlayoffBracket, match: MatchId, winner: string | null): PlayoffBracket {
  const players = matchPlayers(bracket, match)
  if (winner !== null && (!players[0] || !players[1] || !players.includes(winner))) {
    throw new Error('Choose a player from a match with both seats filled.')
  }
  if ((bracket.winners[match] ?? null) === winner) return bracket
  const winners = { ...bracket.winners }
  delete winners[match]
  if (winner !== null) winners[match] = winner
  if (match === 'semi1' || match === 'semi2') delete winners.qualifier
  if (match !== 'grand') delete winners.grand
  return { ...bracket, winners }
}
