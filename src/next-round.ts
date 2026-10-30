import { readBoard } from './board'
import { readClubNames } from './club-names'
import type { IClubNames } from './club-names'
import { listDraws, saveNextRound } from './draws'
import type { IDrawResult, IPairing, ISavedDraw } from './draws'
import type { IBoardDraw, IBoardPair, IStanding } from './match-score'
import { revealPairs } from './reveal'
import type { IRevealPair } from './reveal'
import { freshSwissPairs, randomPairs } from './swiss'
import type { ISwissPair, ISwissPlayer } from './swiss'

const ROUND_LIMIT = 4
const ROUND_DEADLINES = ['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12']
const ROUND_PAIRINGS = ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06']

interface IHistory {
  whites: number
  blacks: number
  lastColor: 'white' | 'black' | null
  opponents: Set<string>
  hadBye: boolean
}

interface IRoundPlan {
  expectedCount: number
  previousId: number
  closed: IDrawResult
  next: IDrawResult
  explained: ISwissPair[]
}

type RoundPlanResult = { ok: true; plan: IRoundPlan } | { ok: false; status: 400 | 409; error: string }

export interface IPreviewSide {
  name: string
  points: number
  gameWins: number
}

export interface IPreviewPair {
  white: string
  black: string | null
  kind: ISwissPair['kind']
  rematch: boolean
  reason: string
  whitePlayer: IPreviewSide
  blackPlayer: IPreviewSide | null
}

export type PreviewRoundResult =
  | { ok: true; round: number; pairs: IPreviewPair[] }
  | { ok: false; status: 400 | 409; error: string }

export async function previewNextRound(round: number): Promise<PreviewRoundResult> {
  const planned = await planNextRound(round, true, 'score')
  if (!planned.ok) {
    return planned
  }

  return {
    ok: true,
    round,
    pairs: planned.plan.explained.map(toPreviewPair),
  }
}

export interface IKeptPair {
  white: string
  black: string | null
}

// 'score' pairs by points (the Swiss draw); 'random' ignores points.
export type DrawMode = 'score' | 'random'

export type GenerateRoundResult =
  | { ok: true; draw: ISavedDraw; pairs: IRevealPair[] }
  | { ok: true; confirm: IPreviewPair[] }
  | { ok: false; status: 400 | 409; error: string }

// A score draw without rematches is saved straight away. A draw that repeats an old match, and every random
// draw, is returned for the organizer to confirm instead. Kept pairs are the ones the organizer confirmed;
// they must seat every player exactly once. A saved draw comes back with the points it was drawn from.
export async function generateNextRound(round: number, kept: IKeptPair[] | null, mode: DrawMode): Promise<GenerateRoundResult> {
  const planned = await planNextRound(round, false, mode)
  if (!planned.ok) {
    return planned
  }

  let next = planned.plan.next
  if (kept) {
    const checked = checkKeptPairs(kept, planned.plan.explained)
    if (!checked) {
      return { ok: false, status: 400, error: 'Those pairs do not seat every player exactly once.' }
    }
    next = { pairs: checked }
  } else if (mode === 'random' || planned.plan.explained.some((pair) => pair.rematch)) {
    return { ok: true, confirm: planned.plan.explained.map(toPreviewPair) }
  }

  const saved = await saveNextRound({
    expectedCount: planned.plan.expectedCount,
    previousId: planned.plan.previousId,
    previous: planned.plan.closed,
    next,
  })
  if (!saved.ok) {
    return saved
  }
  return { ok: true, draw: saved.draw, pairs: revealPairs(next.pairs, planned.plan.explained) }
}

function checkKeptPairs(kept: IKeptPair[], planned: ISwissPair[]): IPairing[] | null {
  const names = new Map<string, string>()
  for (const pair of planned) {
    names.set(nameKey(pair.white), pair.white)
    if (pair.black) {
      names.set(nameKey(pair.black), pair.black)
    }
  }

  const seated = new Set<string>()
  const pairs: IPairing[] = []
  let byes = 0
  for (const pair of kept) {
    const white = names.get(nameKey(pair.white))
    const black = pair.black === null ? null : names.get(nameKey(pair.black))
    if (!white || black === undefined || seated.has(nameKey(white)) || (black && seated.has(nameKey(black)))) {
      return null
    }
    if (black && nameKey(black) === nameKey(white)) {
      return null
    }
    seated.add(nameKey(white))
    if (black) {
      seated.add(nameKey(black))
    } else {
      byes += 1
    }
    pairs.push({ white, black, games: [] })
  }

  if (seated.size !== names.size || byes !== names.size % 2) {
    return null
  }
  return pairs
}

async function planNextRound(round: number, ignoreDate: boolean, mode: DrawMode): Promise<RoundPlanResult> {
  if (!Number.isInteger(round) || round < 2 || round > ROUND_LIMIT) {
    return { ok: false, status: 400, error: 'That round cannot be drawn.' }
  }
  if (!ignoreDate && !roundIsDue(round)) {
    return { ok: false, status: 400, error: 'That round is not ready to draw yet.' }
  }

  const saved = await listDraws()
  const chronological = [...saved].sort(byCreated)
  if (chronological.length === 0) {
    return { ok: false, status: 400, error: 'Draw round 1 before generating the next round.' }
  }
  if (chronological.length + 1 !== round) {
    return { ok: false, status: 409, error: 'That round is already drawn.' }
  }

  const previous = chronological[chronological.length - 1]
  if (!previous) {
    return { ok: false, status: 400, error: 'Draw round 1 before generating the next round.' }
  }

  const [board, club] = await Promise.all([readBoard(), readClubNames()])
  const scored = board.draws.find((draw) => draw.id === previous.id)
  if (!scored) {
    return { ok: false, status: 400, error: 'The current round was not found.' }
  }

  const players = swissPlayers(board.standings, [...board.draws].reverse())
  const explained = mode === 'random' ? randomPairs(players) : freshSwissPairs(players)
  const next: IDrawResult = {
    pairs: explained.map(toStoredPair),
  }
  const closed = withSkips(previous.result, scored, club)

  return {
    ok: true,
    plan: {
      expectedCount: chronological.length,
      previousId: previous.id,
      closed,
      next,
      explained,
    },
  }
}

function swissPlayers(standings: IStanding[], draws: IBoardDraw[]): ISwissPlayer[] {
  const history = new Map<string, IHistory>()
  for (const draw of draws) {
    for (const pair of draw.pairs) {
      notePair(history, pair)
    }
  }

  return standings.map((standing) => toSwissPlayer(standing, history))
}

function notePair(history: Map<string, IHistory>, pair: IBoardPair): void {
  const white = takeHistory(history, pair.white)
  if (!pair.black) {
    white.hadBye = true
    return
  }

  const black = takeHistory(history, pair.black)
  white.whites += 1
  white.lastColor = 'white'
  white.opponents.add(nameKey(pair.black))
  black.blacks += 1
  black.lastColor = 'black'
  black.opponents.add(nameKey(pair.white))
}

function toSwissPlayer(standing: IStanding, history: Map<string, IHistory>): ISwissPlayer {
  const row = history.get(nameKey(standing.name)) ?? blankHistory()
  return {
    name: standing.name,
    points: standing.points,
    gameWins: standing.gameWins,
    whites: row.whites,
    blacks: row.blacks,
    lastColor: row.lastColor,
    opponents: [...row.opponents],
    hadBye: row.hadBye,
  }
}

function withSkips(result: IDrawResult, scored: IBoardDraw, club: IClubNames): IDrawResult {
  return {
    pairs: result.pairs.map((pair) => skipPair(pair, scored, club)),
  }
}

function skipPair(pair: IPairing, scored: IBoardDraw, club: IClubNames): IPairing {
  if (!pair.black || pair.skipped) {
    return pair
  }
  const match = scored.pairs.find((item) => club.same(item.white, pair.white) && club.same(item.black, pair.black))
  if (!match || !unfinished(match)) {
    return pair
  }
  return { ...pair, skipped: true }
}

function unfinished(pair: IBoardPair): boolean {
  if (pair.status === 'open') {
    return true
  }
  if (pair.status !== 'playing') {
    return false
  }
  return pair.games.some((game) => game.outcome !== 'unknown')
}

function toStoredPair(pair: ISwissPair): IPairing {
  return { white: pair.white, black: pair.black, games: [] }
}

function toPreviewPair(pair: ISwissPair): IPreviewPair {
  return {
    white: pair.white,
    black: pair.black,
    kind: pair.kind,
    rematch: pair.rematch,
    reason: pair.reason,
    whitePlayer: pair.whitePlayer,
    blackPlayer: pair.blackPlayer,
  }
}

function takeHistory(history: Map<string, IHistory>, name: string): IHistory {
  const key = nameKey(name)
  const existing = history.get(key)
  if (existing) {
    return existing
  }
  const created = blankHistory()
  history.set(key, created)
  return created
}

function blankHistory(): IHistory {
  return {
    whites: 0,
    blacks: 0,
    lastColor: null,
    opponents: new Set<string>(),
    hadBye: false,
  }
}

function roundIsDue(round: number, today = new Date()): boolean {
  const previousDeadline = ROUND_DEADLINES[round - 2]
  const pairing = ROUND_PAIRINGS[round - 1]
  if (!previousDeadline || !pairing) {
    return false
  }
  const key = dayKey(today)
  return key >= previousDeadline || key >= pairing
}

function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function byCreated(left: ISavedDraw, right: ISavedDraw): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id - right.id
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}
