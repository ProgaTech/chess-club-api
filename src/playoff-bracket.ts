import type { IStanding } from './match-score'

export type MatchId = 'semi1' | 'semi2' | 'qualifier' | 'grand'
export interface PlayoffBracket {
  finalist: string
  seeds: [string, string, string, string]
  winners: Partial<Record<MatchId, string>>
  games?: Partial<Record<MatchId, string[]>>
}

export const MATCH_IDS: MatchId[] = ['semi1', 'semi2', 'qualifier', 'grand']

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
// Game links stay on a later match only while its two players stay the same.
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
  const next: PlayoffBracket = { ...bracket, winners }
  if (!bracket.games) return next
  const games = { ...bracket.games }
  for (const id of MATCH_IDS) {
    const before = matchPlayers(bracket, id)
    const after = matchPlayers(next, id)
    if (before[0] !== after[0] || before[1] !== after[1]) delete games[id]
  }
  return { ...next, games }
}

// Adds a normalized Chess.com link to a match whose two seats are filled.
export function addGame(bracket: PlayoffBracket, match: MatchId, url: string): PlayoffBracket {
  const players = matchPlayers(bracket, match)
  if (!players[0] || !players[1]) throw new Error('Both players must be known before adding a game.')
  if (MATCH_IDS.some(id => bracket.games?.[id]?.includes(url))) throw new Error('That game is already in the playoff.')
  return { ...bracket, games: { ...bracket.games, [match]: [...(bracket.games?.[match] ?? []), url] } }
}
