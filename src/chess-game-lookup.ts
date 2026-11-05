import { chessGameRef } from './chess-game'
import { openingName } from './opening-name'

const CALLBACK = 'https://www.chess.com/callback'
const USER_AGENT = 'ChessClubApp/1.0 (club games)'
const CACHE_MS = 6 * 60 * 60 * 1000
const ERROR_CACHE_MS = 30 * 1000

export interface IChessGameDetails {
  url: string
  finishedStandard: boolean
  startFen: string | null
  white: string
  black: string
  whiteRating: number | null
  blackRating: number | null
  whiteChange: number | null
  blackChange: number | null
  result: '1-0' | '0-1' | '1/2-1/2' | null
  winner: 'white' | 'black' | 'draw' | null
  resultMessage: string | null
  timeControl: string | null
  opening: string | null
  playedAt: string | null
  moveList: string | null
}

interface ICacheEntry {
  at: number
  value: IChessGameDetails | null
}

interface ILooseRecord {
  [key: string]: unknown
}

const cache = new Map<string, ICacheEntry>()

export async function lookupChessGame(url: string): Promise<IChessGameDetails | null> {
  const ref = chessGameRef(url)
  if (!ref) {
    return null
  }

  const hit = cache.get(ref.url)
  const lifetime = hit?.value ? CACHE_MS : ERROR_CACHE_MS
  if (hit && Date.now() - hit.at < lifetime) {
    return hit.value
  }

  const value = await fetchGame(ref.pace, ref.id, ref.url)
  cache.set(ref.url, { at: Date.now(), value })
  return value
}

async function fetchGame(
  pace: 'live' | 'daily',
  id: string,
  url: string,
): Promise<IChessGameDetails | null> {
  const path = pace === 'live' ? `/live/game/${id}` : `/daily/game/${id}`
  try {
    const response = await fetch(`${CALLBACK}${path}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return null
    }
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('json')) {
      return null
    }
    return parseGame(await response.json(), url)
  } catch {
    return null
  }
}

function parseGame(body: unknown, url: string): IChessGameDetails | null {
  const root = asRecord(body)
  const game = asRecord(root?.game)
  if (!game) {
    return null
  }

  const headers = asRecord(game.pgnHeaders) ?? {}
  const white = readString(headers.White)
  const black = readString(headers.Black)
  if (!white || !black) {
    return null
  }

  const result = readResult(headers.Result)
  return {
    url,
    finishedStandard: game.isFinished === true && ['standard', 'chess', 'normal'].includes(String(game.type ?? 'standard').toLowerCase()),
    startFen: readString(headers.FEN),
    white,
    black,
    whiteRating: readNumber(headers.WhiteElo),
    blackRating: readNumber(headers.BlackElo),
    whiteChange: readNumber(game.ratingChangeWhite),
    blackChange: readNumber(game.ratingChangeBlack),
    result,
    winner: readWinner(result, readString(game.colorOfWinner)),
    resultMessage: readString(game.resultMessage),
    timeControl: formatTimeControl(readString(headers.TimeControl)),
    opening: openingName(readString(game.moveList), readString(headers.ECO)),
    playedAt: readPlayedAt(game.endTime),
    moveList: readString(game.moveList),
  }
}

function readResult(value: unknown): '1-0' | '0-1' | '1/2-1/2' | null {
  if (value === '1-0' || value === '0-1' || value === '1/2-1/2') {
    return value
  }
  return null
}

function readWinner(
  result: '1-0' | '0-1' | '1/2-1/2' | null,
  colorOfWinner: string | null,
): 'white' | 'black' | 'draw' | null {
  if (result === '1/2-1/2') {
    return 'draw'
  }
  if (colorOfWinner === 'white' || colorOfWinner === 'black') {
    return colorOfWinner
  }
  if (result === '1-0') {
    return 'white'
  }
  if (result === '0-1') {
    return 'black'
  }
  return null
}

function formatTimeControl(value: string | null): string | null {
  if (!value) {
    return null
  }
  const daily = value.match(/^1\/(\d+)$/)
  if (daily?.[1]) {
    const days = Math.max(1, Math.round(Number(daily[1]) / 86400))
    return days === 1 ? '1 day' : `${days} days`
  }
  const clock = value.match(/^(\d+)(?:\+(\d+))?$/)
  if (!clock?.[1]) {
    return value
  }
  const base = Number(clock[1])
  const increment = clock[2]
  const minutes = base % 60 === 0 ? String(base / 60) : null
  if (increment && increment !== '0') {
    return `${minutes ?? `${base}s`}+${increment}`
  }
  return minutes ? `${minutes} min` : `${base}s`
}

function readPlayedAt(value: unknown): string | null {
  const seconds = readNumber(value)
  if (seconds === null) {
    return null
  }
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function readString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): ILooseRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as ILooseRecord
}
