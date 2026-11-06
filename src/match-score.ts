export const WINS_TO_TAKE_THE_MATCH = 2
export const DRAWS_TO_SPLIT_THE_MATCH = 2
export const SPLIT_POINT = 0.5

export type GameOutcome = 'white' | 'black' | 'draw' | 'unknown'
export type MatchStatus = 'open' | 'playing' | 'played' | 'split' | 'bye' | 'skipped'

export interface IScoreAlias {
  username: string
  name: string
}

export interface IScoreGameInput {
  url: string
  winner: 'white' | 'black' | 'draw' | null
  whiteUsername: string | null
  blackUsername: string | null
  result: '1-0' | '0-1' | '1/2-1/2' | null
  summary: string | null
  playedAt: string | null
  moveList: string | null
  opening: string | null
}

export interface IScorePairInput {
  white: string
  black: string | null
  across: boolean
  skipped: boolean
  games: IScoreGameInput[]
}

export interface IBoardGame {
  url: string
  outcome: GameOutcome
  winnerName: string | null
  // Actual game color, which can differ from the tournament pairing's side.
  winnerColor: 'white' | 'black' | null
  summary: string | null
  playedAt: string | null
  moveList: string | null
  opening: string | null
}

export interface IBoardPair {
  white: string
  black: string | null
  across: boolean
  games: IBoardGame[]
  whiteGameWins: number
  blackGameWins: number
  status: MatchStatus
  winner: string | null
  whitePoints: number
  blackPoints: number
}

export interface IBoardDraw {
  id: number
  createdAt: string
  round: number
  pairs: IBoardPair[]
}

export interface IStanding {
  name: string
  points: number
  played: number
  wins: number
  draws: number
  losses: number
  gameWins: number
}

export interface IClubBoard {
  draws: IBoardDraw[]
  standings: IStanding[]
}

interface IStandingBucket {
  name: string
  points: number
  played: number
  wins: number
  draws: number
  losses: number
  gameWins: number
}

interface IOrderedGame {
  game: IScoreGameInput
  index: number
}

export function aliasMap(rows: IScoreAlias[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const username = row.username.trim().toLowerCase()
    const name = row.name.trim()
    if (username && name) {
      map.set(username, name)
    }
  }
  return map
}

export function scorePair(input: IScorePairInput, aliases: Map<string, string>): IBoardPair {
  if (!input.black) {
    return {
      white: input.white,
      black: null,
      across: input.across,
      games: [],
      whiteGameWins: 0,
      blackGameWins: 0,
      status: 'bye',
      winner: input.white,
      whitePoints: 1,
      blackPoints: 0,
    }
  }

  const black = input.black
  let whiteGameWins = 0
  let blackGameWins = 0
  let draws = 0
  let settled: 'white' | 'black' | 'split' | null = null
  const games: IBoardGame[] = []

  for (const game of orderedGames(input.games)) {
    const outcome = gameOutcome(game, input.white, black, aliases)
    const winnerColor = gameWinnerColor(game)
    if (!settled) {
      if (outcome === 'white') {
        whiteGameWins += 1
      }
      if (outcome === 'black') {
        blackGameWins += 1
      }
      if (outcome === 'draw') {
        draws += 1
      }
      if (whiteGameWins >= WINS_TO_TAKE_THE_MATCH) {
        settled = 'white'
      } else if (blackGameWins >= WINS_TO_TAKE_THE_MATCH) {
        settled = 'black'
      } else if (draws >= DRAWS_TO_SPLIT_THE_MATCH) {
        settled = 'split'
      }
    }

    games.push({
      url: game.url,
      outcome,
      winnerName: outcome === 'white' ? input.white : outcome === 'black' ? black : null,
      winnerColor: winnerColor === 'draw' ? null : winnerColor,
      summary: game.summary,
      playedAt: game.playedAt,
      moveList: game.moveList,
      opening: game.opening,
    })
  }

  const winner = settled === 'white' ? input.white : settled === 'black' ? black : null
  const status: MatchStatus = input.skipped
    ? 'skipped'
    : settled === 'split'
      ? 'split'
      : winner
        ? 'played'
        : games.length > 0
          ? 'playing'
          : 'open'

  return {
    white: input.white,
    black,
    across: input.across,
    games,
    whiteGameWins,
    blackGameWins,
    status,
    winner: input.skipped ? null : winner,
    whitePoints: input.skipped ? 0 : settled === 'white' ? 1 : settled === 'split' ? SPLIT_POINT : 0,
    blackPoints: input.skipped ? 0 : settled === 'black' ? 1 : settled === 'split' ? SPLIT_POINT : 0,
  }
}

export function standingsFrom(draws: IBoardDraw[]): IStanding[] {
  const buckets = new Map<string, IStandingBucket>()

  for (const draw of draws) {
    for (const pair of draw.pairs) {
      const white = bucketFor(buckets, pair.white)
      white.points += pair.whitePoints
      white.gameWins += pair.whiteGameWins
      recordResult(white, pair, 'white')

      if (!pair.black) {
        continue
      }

      const black = bucketFor(buckets, pair.black)
      black.points += pair.blackPoints
      black.gameWins += pair.blackGameWins
      recordResult(black, pair, 'black')
    }
  }

  return [...buckets.values()].sort(byStanding)
}

function orderedGames(games: IScoreGameInput[]): IScoreGameInput[] {
  const rows: IOrderedGame[] = games.map((game, index) => ({ game, index }))
  rows.sort((left, right) => {
    const leftTime = left.game.playedAt ?? ''
    const rightTime = right.game.playedAt ?? ''
    if (leftTime && rightTime && leftTime !== rightTime) {
      return leftTime.localeCompare(rightTime)
    }
    if (leftTime && !rightTime) {
      return -1
    }
    if (!leftTime && rightTime) {
      return 1
    }
    return left.index - right.index
  })
  return rows.map((row) => row.game)
}

function gameOutcome(
  game: IScoreGameInput,
  white: string,
  black: string,
  aliases: Map<string, string>,
): GameOutcome {
  const color = gameWinnerColor(game)
  if (color === 'draw') {
    return 'draw'
  }
  if (!color || !game.whiteUsername || !game.blackUsername) {
    return 'unknown'
  }
  const username = color === 'white' ? game.whiteUsername : game.blackUsername
  return pairingSide(username, white, black, aliases) ?? 'unknown'
}

function gameWinnerColor(game: IScoreGameInput): 'white' | 'black' | 'draw' | null {
  if (game.winner === 'draw' || game.result === '1/2-1/2') {
    return 'draw'
  }
  if (game.winner === 'white' || game.winner === 'black') {
    return game.winner
  }
  if (game.result === '1-0') {
    return 'white'
  }
  if (game.result === '0-1') {
    return 'black'
  }
  return null
}

function pairingSide(
  username: string,
  white: string,
  black: string,
  aliases: Map<string, string>,
): 'white' | 'black' | null {
  const mapped = aliases.get(username.trim().toLowerCase())
  if (mapped && same(mapped, white)) {
    return 'white'
  }
  if (mapped && same(mapped, black)) {
    return 'black'
  }
  if (same(username, white)) {
    return 'white'
  }
  if (same(username, black)) {
    return 'black'
  }
  return null
}

function bucketFor(buckets: Map<string, IStandingBucket>, name: string): IStandingBucket {
  const key = name.trim().toLowerCase()
  const existing = buckets.get(key)
  if (existing) {
    return existing
  }
  const created: IStandingBucket = {
    name: name.trim(),
    points: 0,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gameWins: 0,
  }
  buckets.set(key, created)
  return created
}

function recordResult(bucket: IStandingBucket, pair: IBoardPair, side: 'white' | 'black') {
  if (pair.status === 'skipped') {
    return
  }
  const finished = pair.status === 'played' || pair.status === 'split' || pair.status === 'bye'
  if (!finished || (pair.status === 'bye' && side === 'black')) {
    return
  }
  const name = side === 'white' ? pair.white : pair.black
  bucket.played += 1
  if (pair.status === 'split') {
    bucket.draws += 1
    return
  }
  if (pair.status === 'bye' || (pair.winner && name && same(pair.winner, name))) {
    bucket.wins += 1
    return
  }
  bucket.losses += 1
}

function byStanding(left: IStandingBucket, right: IStandingBucket): number {
  return (
    right.points - left.points ||
    right.gameWins - left.gameWins ||
    right.wins - left.wins ||
    left.name.localeCompare(right.name)
  )
}

function same(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
