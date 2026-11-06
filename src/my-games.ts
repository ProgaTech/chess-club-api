import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db/client'
import { chessGames } from './db/schema'
import type { IAccount } from './accounts'
import { readClubNames } from './club-names'
import type { IClubNames } from './club-names'
import { lookupChessGame } from './chess-game-lookup'
import type { IChessGameDetails } from './chess-game-lookup'
import { listDraws } from './draws'

import { chessGameRef } from './chess-game'

export function analysisGameKey(url: string) {
  const ref = chessGameRef(url)
  return ref ? ref.pace + '-' + ref.id : null
}

export async function sharedGameUrl(key: string) {
  for (const draw of await listDraws()) {
    for (const pair of draw.result.pairs) {
      const url = pair.games.find(url => analysisGameKey(url) === key)
      if (url) return url
    }
  }
  return null
}

export interface IMyGame {
  analysisGameId: string | null
  url: string
  opponent: string
  color: 'white' | 'black'
  outcome: 'win' | 'loss' | 'draw' | 'unknown'
  summary: string
  white: string
  black: string
  whiteRating: number | null
  blackRating: number | null
  whiteChange: number | null
  blackChange: number | null
  timeControl: string | null
  opening: string | null
  playedAt: string | null
  moveList: string | null
  yours: boolean
}

interface IListedGame {
  url: string
  opponent: string
  color: 'white' | 'black'
  fallbackAt: string
}

const LOOKUP_LIMIT = 4

export interface IGameSubject {
  names: string[]
  chessCom: string | null
}

export async function listMyGames(account: IAccount): Promise<IMyGame[]> {
  const games = await listPlayerGames({ names: playerNames(account), chessCom: account.chessCom })
  const ids = games.flatMap(game => chessGameRef(game.url)?.id ?? [])
  if (!ids.length) return games
  const saved = await db.select({
    id: chessGames.externalId, pace: chessGames.pace, status: chessGames.status,
    variant: chessGames.variant, result: chessGames.result, pgn: chessGames.pgn, moves: chessGames.encodedMoveList,
  }).from(chessGames).where(and(eq(chessGames.provider, 'chess.com'), inArray(chessGames.externalId, ids)))
  const byKey = new Map(saved.map(row => [row.pace + '-' + row.id, row]))
  return games.map(game => {
    const key = analysisGameKey(game.url)
    const row = key && byKey.get(key)
    if (!row) return game
    const eligible = row.status === 'finished' && /^(standard|normal|chess)$/i.test(row.variant ?? 'standard')
      && (row.pgn || (row.moves && row.result !== 'unknown'))
    return {...game, analysisGameId: eligible ? key : null}
  })
}

export async function listPlayerGames(subject: IGameSubject): Promise<IMyGame[]> {
  const club = await readClubNames()
  const listed = await listedGames(subject.names, club)
  const games = await mapPool(listed, LOOKUP_LIMIT, (game) => describeGame(subject, game))
  return games.sort((left, right) => (right.playedAt ?? '').localeCompare(left.playedAt ?? ''))
}

async function listedGames(names: string[], club: IClubNames): Promise<IListedGame[]> {
  const draws = await listDraws()
  const listed: IListedGame[] = []
  const seen = new Set<string>()

  for (const draw of draws) {
    const pairs = draw.result.pairs
    for (const pair of pairs) {
      if (!pair.black) {
        continue
      }
      const color = colorInPair(names, pair.white, pair.black)
      if (!color) {
        continue
      }
      const opponent = club.canonical(color === 'white' ? pair.black : pair.white)
      for (const url of pair.games) {
        const key = `${url.toLowerCase()}|${opponent.toLowerCase()}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        listed.push({ url, opponent, color, fallbackAt: draw.createdAt })
      }
    }
  }

  return listed
}

async function describeGame(subject: IGameSubject, listed: IListedGame): Promise<IMyGame> {
  const details = await lookupChessGame(listed.url)
  if (!details) {
    return {
      analysisGameId: null,
      url: listed.url,
      opponent: listed.opponent,
      color: listed.color,
      outcome: 'unknown',
      summary: 'Chess.com did not return this game.',
      white: '',
      black: '',
      whiteRating: null,
      blackRating: null,
      whiteChange: null,
      blackChange: null,
      timeControl: null,
      opening: null,
      playedAt: listed.fallbackAt,
      moveList: null,
      yours: false,
    }
  }

  const color = sideFor(subject.chessCom, listed.color, details)
  const yours = usernameMatches(subject.chessCom, details, color) || !subject.chessCom
  const outcome = yours ? outcomeFor(color, details.winner) : 'unknown'
  return {
    analysisGameId: details.finishedStandard && details.result && details.moveList ? analysisGameKey(details.url) : null,
    url: details.url,
    opponent: listed.opponent,
    color,
    outcome,
    summary: summaryFor(details, outcome, yours),
    white: details.white,
    black: details.black,
    whiteRating: details.whiteRating,
    blackRating: details.blackRating,
    whiteChange: details.whiteChange,
    blackChange: details.blackChange,
    timeControl: details.timeControl,
    opening: details.opening,
    playedAt: details.playedAt ?? listed.fallbackAt,
    moveList: details.moveList,
    yours,
  }
}

function sideFor(chessCom: string | null, clubColor: 'white' | 'black', details: IChessGameDetails): 'white' | 'black' {
  const username = chessCom?.toLowerCase()
  if (username && details.white.toLowerCase() === username) {
    return 'white'
  }
  if (username && details.black.toLowerCase() === username) {
    return 'black'
  }
  return clubColor
}

function usernameMatches(chessCom: string | null, details: IChessGameDetails, color: 'white' | 'black'): boolean {
  const username = chessCom?.toLowerCase()
  if (!username) {
    return false
  }
  const player = color === 'white' ? details.white : details.black
  return player.toLowerCase() === username
}

function outcomeFor(color: 'white' | 'black', winner: 'white' | 'black' | 'draw' | null): IMyGame['outcome'] {
  if (winner === 'draw') {
    return 'draw'
  }
  if (winner === color) {
    return 'win'
  }
  if (winner) {
    return 'loss'
  }
  return 'unknown'
}

function summaryFor(details: IChessGameDetails, outcome: IMyGame['outcome'], yours: boolean): string {
  const message = details.resultMessage
  if (!yours) {
    return message ?? 'Finished game'
  }
  const reason = message?.match(/ won (by .+|on .+)$/i)?.[1]
  if (outcome === 'win') {
    return reason ? `Won ${reason}` : 'Won'
  }
  if (outcome === 'loss') {
    return reason ? `Lost ${reason}` : 'Lost'
  }
  if (outcome === 'draw') {
    return message ?? 'Draw'
  }
  return message ?? 'Finished game'
}

function playerNames(account: IAccount): string[] {
  const full = `${account.name} ${account.surname}`.trim()
  const names = full ? [full] : []
  if (account.signupName && !names.some((name) => sameName(name, account.signupName ?? ''))) {
    names.push(account.signupName)
  }
  return names
}

function colorInPair(names: string[], white: string, black: string): 'white' | 'black' | null {
  if (names.some((name) => sameName(name, white))) {
    return 'white'
  }
  if (names.some((name) => sameName(name, black))) {
    return 'black'
  }
  return null
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      const item = items[current]
      if (item !== undefined) {
        results[current] = await task(item)
      }
    }
  })
  await Promise.all(workers)
  return results
}
