import { materialSwing } from './material-swing'
import type { IMaterialSwing } from './material-swing'
import type { IBoardDraw, IStanding } from './match-score'

export interface IRecordMark {
  names: string[]
  playedAt: string | null
  url: string | null
  moves: number | null
  games: number | null
  deficit: number | null
  opponent: string | null
  current: boolean
}

interface IPlayedGame {
  url: string
  white: string
  black: string
  winner: string | null
  winnerColor: 'white' | 'black' | null
  decisive: boolean
  playedAt: string | null
  plies: number | null
  moveList: string | null
}

const TOURNAMENT_ROUNDS = 4

interface ICount {
  name: string
  games: number
  playedAt: string | null
  url: string | null
}

export interface IAchievements {
  firstGame: IRecordMark[]
  quickestWin: IRecordMark[]
  longestGame: IRecordMark[]
  mostGames: IRecordMark[]
  recovery: IRecordMark[]
  tournament: IRecordMark[]
}

export function achievementsFrom(draws: IBoardDraw[], standings: IStanding[]): IAchievements {
  const games = playedGames(draws)
  return {
    firstGame: firstGame(games),
    quickestWin: quickestWins(games),
    longestGame: longestGames(games),
    mostGames: mostGames(games),
    recovery: recoveries(games),
    tournament: tournamentWinners(draws, standings),
  }
}

function playedGames(draws: IBoardDraw[]): IPlayedGame[] {
  const games: IPlayedGame[] = []
  for (const draw of draws) {
    for (const pair of draw.pairs) {
      if (!pair.black) {
        continue
      }
      for (const game of pair.games) {
        if (game.outcome === 'unknown') {
          continue
        }
        games.push({
          url: game.url,
          white: pair.white,
          black: pair.black,
          winner: game.winnerName,
          winnerColor: game.winnerColor,
          decisive: game.outcome === 'white' || game.outcome === 'black',
          playedAt: game.playedAt,
          plies: pliesOf(game.moveList),
          moveList: game.moveList,
        })
      }
    }
  }
  games.sort(byPlayed)
  return games
}

function firstGame(games: IPlayedGame[]): IRecordMark[] {
  const game = games[0]
  if (!game) {
    return []
  }
  return [
    {
      names: [game.white, game.black],
      playedAt: game.playedAt,
      url: game.url,
      moves: null,
      games: null,
      deficit: null,
      opponent: null,
      current: true,
    },
  ]
}

function quickestWins(games: IPlayedGame[]): IRecordMark[] {
  const marks: IRecordMark[] = []
  let best: number | null = null
  for (const game of games) {
    if (!game.decisive || !game.winner || game.plies === null) {
      continue
    }
    const moves = Math.ceil(game.plies / 2)
    if (best !== null && moves >= best) {
      continue
    }
    best = moves
    marks.push({
      names: [game.winner],
      playedAt: game.playedAt,
      url: game.url,
      moves,
      games: null,
      deficit: null,
      opponent: game.winner.toLowerCase() === game.white.toLowerCase() ? game.black : game.white,
      current: false,
    })
  }
  const latest = marks[marks.length - 1]
  if (latest) {
    latest.current = true
  }
  return marks.reverse()
}

function longestGames(games: IPlayedGame[]): IRecordMark[] {
  const marks: IRecordMark[] = []
  let best: number | null = null
  for (const game of games) {
    if (game.plies === null) {
      continue
    }
    const moves = Math.ceil(game.plies / 2)
    if (best !== null && moves <= best) {
      continue
    }
    best = moves
    marks.push({
      names: [game.white, game.black],
      playedAt: game.playedAt,
      url: game.url,
      moves,
      games: null,
      deficit: null,
      opponent: null,
      current: false,
    })
  }
  const latest = marks[marks.length - 1]
  if (latest) {
    latest.current = true
  }
  return marks.reverse()
}

interface ISwingMark {
  name: string
  opponent: string
  deficit: number
  playedAt: string | null
  url: string
}

function recoveries(games: IPlayedGame[]): IRecordMark[] {
  const earlier: IRecordMark[] = []
  let record = 0
  let holders: ISwingMark[] = []

  for (const game of games) {
    const swing = swingOf(game)
    if (!swing || swing.deficit >= 0) {
      continue
    }
    const down = -swing.deficit
    if (down < record) {
      continue
    }
    const mark: ISwingMark = {
      name: game.winner ?? '',
      opponent: opponentOf(game),
      deficit: down,
      playedAt: game.playedAt,
      url: game.url,
    }
    if (down > record) {
      earlier.push(...holders.map((holder) => swingMark(holder, false)))
      record = down
      holders = [mark]
      continue
    }
    holders.push(mark)
  }

  const current = holders.map((holder) => swingMark(holder, true))
  current.sort((left, right) => (left.names[0] ?? '').localeCompare(right.names[0] ?? ''))
  return [...current, ...earlier.reverse()]
}

function tournamentWinners(draws: IBoardDraw[], standings: IStanding[]): IRecordMark[] {
  if (!tournamentFinished(draws)) {
    return []
  }
  const top = standings[0]
  if (!top || top.points <= 0) {
    return []
  }
  return standings
    .filter((standing) => standing.points === top.points)
    .map((standing) => ({
      names: [standing.name],
      playedAt: null,
      url: null,
      moves: null,
      games: null,
      deficit: null,
      opponent: null,
      current: true,
    }))
}

function tournamentFinished(draws: IBoardDraw[]): boolean {
  const rounds = new Set(draws.map((draw) => draw.round))
  if (rounds.size < TOURNAMENT_ROUNDS) {
    return false
  }
  for (const draw of draws) {
    for (const pair of draw.pairs) {
      if (pair.status !== 'played' && pair.status !== 'split' && pair.status !== 'bye' && pair.status !== 'skipped') {
        return false
      }
    }
  }
  return true
}

function swingOf(game: IPlayedGame): IMaterialSwing | null {
  if (!game.decisive || !game.winner) {
    return null
  }
  if (!game.winnerColor) {
    return null
  }
  return materialSwing(game.moveList, game.winnerColor)
}

function opponentOf(game: IPlayedGame): string {
  if (!game.winner) {
    return game.black
  }
  return same(game.winner, game.white) ? game.black : game.white
}

function swingMark(mark: ISwingMark, current: boolean): IRecordMark {
  return {
    names: [mark.name],
    playedAt: mark.playedAt,
    url: mark.url,
    moves: null,
    games: null,
    deficit: mark.deficit,
    opponent: mark.opponent,
    current,
  }
}

function mostGames(games: IPlayedGame[]): IRecordMark[] {
  const counts = new Map<string, ICount>()
  const earlier: IRecordMark[] = []
  let record = 0
  let leaders: ICount[] = []

  for (const game of games) {
    const previous = leaders.map(snapshot)
    bump(counts, game.white, game)
    bump(counts, game.black, game)
    const max = highest(counts)
    if (max > record) {
      for (const leader of previous) {
        const now = counts.get(leader.name.trim().toLowerCase())
        if (!now || now.games >= max || held(earlier, leader)) {
          continue
        }
        earlier.push(markFromCount(leader, false))
      }
      record = max
    }
    leaders = [...counts.values()].filter((count) => count.games === record).map(snapshot)
  }

  const current = leaders.map((leader) => markFromCount(leader, true))
  current.sort((left, right) => (left.names[0] ?? '').localeCompare(right.names[0] ?? ''))
  return [...current, ...earlier.reverse()]
}

function highest(counts: Map<string, ICount>): number {
  let max = 0
  for (const count of counts.values()) {
    if (count.games > max) {
      max = count.games
    }
  }
  return max
}

function held(marks: IRecordMark[], count: ICount): boolean {
  return marks.some((mark) => mark.games === count.games && mark.names.some((name) => same(name, count.name)))
}

function snapshot(count: ICount): ICount {
  return { name: count.name, games: count.games, playedAt: count.playedAt, url: count.url }
}

function markFromCount(count: ICount, current: boolean): IRecordMark {
  return {
    names: [count.name],
    playedAt: count.playedAt,
    url: count.url,
    moves: null,
    games: count.games,
    deficit: null,
    opponent: null,
    current,
  }
}

function same(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function bump(counts: Map<string, ICount>, name: string, game: IPlayedGame): ICount {
  const key = name.trim().toLowerCase()
  const existing = counts.get(key)
  if (!existing) {
    const created: ICount = { name: name.trim(), games: 1, playedAt: game.playedAt, url: game.url }
    counts.set(key, created)
    return created
  }
  existing.games += 1
  existing.playedAt = game.playedAt
  existing.url = game.url
  return existing
}

function pliesOf(moveList: string | null): number | null {
  if (!moveList || moveList.length < 2 || moveList.length % 2 !== 0) {
    return null
  }
  return moveList.length / 2
}

function byPlayed(left: IPlayedGame, right: IPlayedGame): number {
  if (left.playedAt && right.playedAt && left.playedAt !== right.playedAt) {
    return left.playedAt.localeCompare(right.playedAt)
  }
  if (left.playedAt && !right.playedAt) {
    return -1
  }
  if (!left.playedAt && right.playedAt) {
    return 1
  }
  return left.url.localeCompare(right.url)
}
