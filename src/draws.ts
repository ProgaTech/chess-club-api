import { desc, eq } from 'drizzle-orm'
import { chessGameUrl } from './chess-game'
import { readClubNames } from './club-names'
import { db } from './db/client'
import { draws } from './db/schema'
import { memberName } from './roles'
import type { IActor } from './roles'

export interface IPairing {
  white: string
  black: string | null
  games: string[]
  across?: boolean
  skipped?: boolean
}

export interface IDrawResult {
  pairs: IPairing[]
}

export interface ISavedDraw {
  id: number
  createdAt: string
  result: IDrawResult
}

interface IDrawRow {
  id: number
  createdAt: Date
  result: unknown
}

export type SaveDrawResult =
  | { ok: true; draw: ISavedDraw }
  | { ok: false; status: 400 | 409; error: string }

export async function listDraws(): Promise<ISavedDraw[]> {
  const rows = await db.select().from(draws).orderBy(desc(draws.createdAt))
  return rows.flatMap((row) => {
    const draw = toSavedDraw(row)
    return draw ? [draw] : []
  })
}

export async function saveDraw(body: unknown): Promise<SaveDrawResult> {
  const result = parseDrawResult(body)
  if (!result) {
    return { ok: false, status: 400, error: 'Send the pairs.' }
  }

  const [row] = await db.insert(draws).values({ result }).returning()
  if (!row) {
    return { ok: false, status: 400, error: 'Could not save this draw.' }
  }

  const draw = toSavedDraw(row)
  if (!draw) {
    return { ok: false, status: 400, error: 'Could not save this draw.' }
  }
  return { ok: true, draw }
}

interface IGameRequest {
  white: string
  black: string
  url: string
}

export type AddGameResult = SaveDrawResult | { ok: false; status: 403; error: string }

export async function addDrawGame(drawId: number, body: unknown, actor: IActor): Promise<AddGameResult> {
  const request = parseGameRequest(body)
  if (request === 'invalid-url') {
    return { ok: false, status: 400, error: 'Paste a Chess.com game link.' }
  }
  if (!request) {
    return { ok: false, status: 400, error: 'Send the match and a Chess.com game link.' }
  }

  const [row] = await db.select().from(draws).where(eq(draws.id, drawId)).limit(1)
  if (!row) {
    return { ok: false, status: 400, error: 'That draw was not found.' }
  }

  const result = parseDrawResult(row.result)
  if (!result) {
    return { ok: false, status: 400, error: 'That draw was not found.' }
  }

  const club = await readClubNames()
  const pair = result.pairs.find((item) => club.same(item.white, request.white) && club.same(item.black, request.black))
  if (!pair?.black) {
    return { ok: false, status: 400, error: 'That match is not in this draw.' }
  }
  if (actor.role !== 'organizer') {
    const me = await memberName(actor.clerkUserId)
    if (!me) {
      return { ok: false, status: 403, error: 'Only club members can add games.' }
    }
    if (!club.same(me, pair.white) && !club.same(me, pair.black)) {
      return { ok: false, status: 403, error: 'Only players in this match can add its games.' }
    }
  }
  if (pair.skipped) {
    return { ok: false, status: 409, error: 'That round is closed.' }
  }
  if (pair.games.includes(request.url)) {
    return { ok: false, status: 409, error: 'That game is already on this match.' }
  }

  pair.games.push(request.url)
  const [updated] = await db.update(draws).set({ result }).where(eq(draws.id, drawId)).returning()
  if (!updated) {
    return { ok: false, status: 400, error: 'Could not save this game.' }
  }

  const draw = toSavedDraw(updated)
  if (!draw) {
    return { ok: false, status: 400, error: 'Could not save this game.' }
  }
  return { ok: true, draw }
}

function parseGameRequest(body: unknown): IGameRequest | 'invalid-url' | null {
  if (!isRecord(body)) {
    return null
  }
  if (typeof body.white !== 'string' || typeof body.black !== 'string' || typeof body.url !== 'string') {
    return null
  }
  const white = body.white.trim()
  const black = body.black.trim()
  if (!white || !black) {
    return null
  }
  const url = chessGameUrl(body.url)
  if (!url) {
    return 'invalid-url'
  }
  return { white, black, url }
}

function samePlayer(left: string | null, right: string | null): boolean {
  return (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
}

function parseDrawResult(body: unknown): IDrawResult | null {
  if (!isRecord(body)) {
    return null
  }
  if (Array.isArray(body.pairs)) {
    const pairs = parsePairs(body.pairs)
    return pairs ? { pairs } : null
  }
  const beginner = parsePairs(body.beginner)
  const advanced = parsePairs(body.advanced)
  if (!beginner || !advanced) {
    return null
  }
  return { pairs: [...beginner, ...advanced] }
}

function parsePairs(value: unknown): IPairing[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const pairs: IPairing[] = []
  for (const item of value) {
    const pair = parsePair(item)
    if (!pair) {
      return null
    }
    pairs.push(pair)
  }
  return pairs
}

function parsePair(value: unknown): IPairing | null {
  if (!isRecord(value) || typeof value.white !== 'string' || !value.white.trim()) {
    return null
  }
  if (value.black !== null && typeof value.black !== 'string') {
    return null
  }
  const games = parseGames(value.games)
  if (!games) {
    return null
  }
  const pair: IPairing = {
    white: value.white.trim(),
    black: typeof value.black === 'string' ? value.black.trim() || null : null,
    games,
  }
  if (value.across === true) {
    pair.across = true
  }
  if (value.skipped === true) {
    pair.skipped = true
  }
  return pair
}

function parseGames(value: unknown): string[] | null {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const games: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return null
    }
    const url = chessGameUrl(item)
    if (!url) {
      return null
    }
    games.push(url)
  }
  return games
}

export interface INextRoundWrite {
  expectedCount: number
  previousId: number
  previous: IDrawResult
  next: IDrawResult
}

export async function saveNextRound(input: INextRoundWrite): Promise<SaveDrawResult> {
  const { expectedCount, previousId, previous, next } = input

  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.select().from(draws).for('update')
      if (locked.length !== expectedCount) {
        return { ok: false, status: 409, error: 'That round is already drawn.' }
      }
      const fresh = locked.find((row) => row.id === previousId)
      const parsed = fresh ? parseDrawResult(fresh.result) : null
      if (!parsed) {
        return { ok: false, status: 400, error: 'The current round was not found.' }
      }

      await tx.update(draws).set({ result: mergeSkips(parsed, previous) }).where(eq(draws.id, previousId))
      const [row] = await tx.insert(draws).values({ result: next }).returning()
      const draw = row ? toSavedDraw(row) : null
      if (!draw) {
        throw new Error('Could not save this draw.')
      }
      return { ok: true, draw }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save this draw.'
    return { ok: false, status: 400, error: message }
  }
}

function mergeSkips(fresh: IDrawResult, plan: IDrawResult): IDrawResult {
  return {
    pairs: fresh.pairs.map((pair) => keepSkip(pair, plan.pairs)),
  }
}

function keepSkip(pair: IPairing, planned: IPairing[]): IPairing {
  const match = planned.find((item) => samePlayer(item.white, pair.white) && samePlayer(item.black, pair.black))
  if (!match?.skipped || match.games.length !== pair.games.length) {
    return pair
  }
  return { ...pair, skipped: true }
}

function toSavedDraw(row: IDrawRow): ISavedDraw | null {
  const result = parseDrawResult(row.result)
  if (!result) {
    return null
  }
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    result,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
