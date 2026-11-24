import type { IStanding } from './match-score'

export type MatchId = 'semi1' | 'semi2' | 'qualifier' | 'grand'
export interface PlayoffBracket {
  finalist: string | null
  seeds: [string | null, string | null, string | null, string | null]
  winners: Partial<Record<MatchId, string>>
  games?: Partial<Record<MatchId, string[]>>
}

export const MATCH_IDS: MatchId[] = ['semi1', 'semi2', 'qualifier', 'grand']
const QUALIFYING_ROUNDS = 4

// Only results that can no longer change count: a contender has finished every qualifying round,
// and the finalist is the one four-win player nobody else can still catch.
export function qualification(standings: IStanding[]) {
  const finalists = standings.filter(player => player.wins === QUALIFYING_ROUNDS)
  const chasing = standings.some(player => player.wins < QUALIFYING_ROUNDS && player.wins + QUALIFYING_ROUNDS - player.played >= QUALIFYING_ROUNDS)
  const finalist = finalists.length === 1 && !chasing ? finalists[0]!.name : null
  const contenders = standings
    .filter(player => player.wins === QUALIFYING_ROUNDS - 1 && player.played >= QUALIFYING_ROUNDS)
    .map(player => player.name)
  let reason: string | null = null
  if (finalists.length > 1) reason = 'More than one player has four wins. The organizer must resolve qualification.'
  else if (contenders.length > 4) reason = 'More than four players finished on three wins. The organizer must resolve qualification.'
  return { finalist, contenders, reason }
}

// Puts each newly qualified player into the next free semifinal seat, in the order they qualify.
// Seats already filled never move. Returns the same bracket when nothing changes.
export function placeQualified(bracket: PlayoffBracket | null, finalist: string | null, contenders: string[]): PlayoffBracket | null {
  if (!bracket && !finalist && contenders.length === 0) return null
  const current: PlayoffBracket = bracket ?? { finalist: null, seeds: [null, null, null, null], winners: {} }
  const seeds: PlayoffBracket['seeds'] = [...current.seeds]
  for (const name of contenders) {
    const free = seeds.indexOf(null)
    if (free === -1) break
    if (!seeds.includes(name)) seeds[free] = name
  }
  const nextFinalist = current.finalist ?? finalist
  if (bracket && nextFinalist === bracket.finalist && seeds.every((name, index) => name === bracket.seeds[index])) return bracket
  return { ...current, finalist: nextFinalist, seeds }
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

// Fills an empty result from the match's games. A result the organizer recorded is kept.
export function advanceFromGames(bracket: PlayoffBracket, match: MatchId, winner: string | null): PlayoffBracket {
  if (!winner || bracket.winners[match]) return bracket
  return recordWinner(bracket, match, winner)
}

// Adds a normalized Chess.com link to a match whose two seats are filled.
export function addGame(bracket: PlayoffBracket, match: MatchId, url: string): PlayoffBracket {
  const players = matchPlayers(bracket, match)
  if (!players[0] || !players[1]) throw new Error('Both players must be known before adding a game.')
  if (MATCH_IDS.some(id => bracket.games?.[id]?.includes(url))) throw new Error('That game is already in the playoff.')
  return { ...bracket, games: { ...bracket.games, [match]: [...(bracket.games?.[match] ?? []), url] } }
}
