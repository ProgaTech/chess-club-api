import { randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { readBoard } from './board'
import { chessGameUrl } from './chess-game'
import { lookupChessGame } from './chess-game-lookup'
import { readClubNames } from './club-names'
import type { IClubNames } from './club-names'
import { db } from './db/client'
import { playoffs } from './db/schema'
import { scorePair } from './match-score'
import type { IBoardGame } from './match-score'
import { addGame, MATCH_IDS, matchPlayers, qualification, recordWinner } from './playoff-bracket'
import type { MatchId, PlayoffBracket } from './playoff-bracket'
import { memberName } from './roles'
import type { IActor } from './roles'

const TOURNAMENT = 'autumn-2026'

export async function readPlayoffs() {
  const [board, rows, club] = await Promise.all([
    readBoard(), db.select().from(playoffs).where(eq(playoffs.id, TOURNAMENT)), readClubNames(),
  ])
  const saved = rows[0] ?? null
  return { ...qualification(board.standings), saved, games: saved ? await matchGames(saved.bracket, club) : {} }
}

// Scores each match's links the same way as a regular draw pair, so game winners use club names.
async function matchGames(bracket: PlayoffBracket, club: IClubNames) {
  const games: Partial<Record<MatchId, IBoardGame[]>> = {}
  await Promise.all(MATCH_IDS.map(async (match) => {
    const [white, black] = matchPlayers(bracket, match)
    const urls = bracket.games?.[match] ?? []
    if (!white || !black || urls.length === 0) return
    const inputs = await Promise.all(urls.map(async (url) => {
      const details = await lookupChessGame(url)
      return {
        url: details?.url ?? url,
        winner: details?.winner ?? null,
        whiteUsername: details?.white ?? null,
        blackUsername: details?.black ?? null,
        result: details?.result ?? null,
        summary: details?.resultMessage ?? null,
        playedAt: details?.playedAt ?? null,
        moveList: details?.moveList ?? null,
        opening: details?.opening ?? null,
      }
    }))
    games[match] = scorePair({ white, black, across: false, skipped: false, games: inputs }, club.chessAliases).games
  }))
  return games
}

type Result = { ok: true } | { ok: false; status: 400 | 403 | 409; error: string }

export async function drawPlayoffs(): Promise<Result> {
  const current = await readPlayoffs()
  if (current.saved) return { ok: false, status: 409, error: 'The playoff has already been drawn.' }
  if (!current.canDraw || !current.finalist) return { ok: false, status: 409, error: current.reason ?? 'Qualification is not complete.' }
  const names = [...current.contenders]
  for (let i = names.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[names[i], names[j]] = [names[j]!, names[i]!]
  }
  const bracket: PlayoffBracket = { finalist: current.finalist, seeds: names as PlayoffBracket['seeds'], winners: {} }
  const rows = await db.insert(playoffs).values({ id: TOURNAMENT, bracket }).onConflictDoNothing().returning()
  return rows.length ? { ok: true } : { ok: false, status: 409, error: 'The playoff has already been drawn. Refresh to see it.' }
}

export async function savePlayoffWinner(body: unknown): Promise<Result> {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Send the match, winner and revision.' }
  const request = body as Record<string, unknown>
  if (!['semi1', 'semi2', 'qualifier', 'grand'].includes(request.match as string)
    || (request.winner !== null && typeof request.winner !== 'string')
    || !Number.isInteger(request.revision)) {
    return { ok: false, status: 400, error: 'Send the match, winner and revision.' }
  }
  const [row] = await db.select().from(playoffs).where(eq(playoffs.id, TOURNAMENT))
  if (!row || row.revision !== request.revision) return { ok: false, status: 409, error: 'The bracket changed. Refresh before recording a result.' }
  let bracket: PlayoffBracket
  try {
    bracket = recordWinner(row.bracket, request.match as MatchId, request.winner as string | null)
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message }
  }
  const updated = await db.update(playoffs).set({ bracket, revision: row.revision + 1 })
    .where(and(eq(playoffs.id, TOURNAMENT), eq(playoffs.revision, row.revision))).returning()
  return updated.length ? { ok: true } : { ok: false, status: 409, error: 'Another result was saved. Refresh and try again.' }
}

export async function addPlayoffGame(body: unknown, actor: IActor): Promise<Result> {
  const request = body && typeof body === 'object' ? body as Record<string, unknown> : null
  if (!request || !MATCH_IDS.includes(request.match as MatchId) || typeof request.url !== 'string') {
    return { ok: false, status: 400, error: 'Send the match and a Chess.com game link.' }
  }
  const url = chessGameUrl(request.url)
  if (!url) return { ok: false, status: 400, error: 'Paste a Chess.com game link.' }
  const match = request.match as MatchId
  const organizer = actor.role === 'organizer'
  const [me, club] = organizer ? [null, null] : await Promise.all([memberName(actor.clerkUserId), readClubNames()])
  if (!organizer && !me) return { ok: false, status: 403, error: 'Only club members can add games.' }

  // Retry when another change lands between the read and the write.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db.select().from(playoffs).where(eq(playoffs.id, TOURNAMENT))
    if (!row) return { ok: false, status: 409, error: 'The playoff has not been drawn yet.' }
    const [white, black] = matchPlayers(row.bracket, match)
    if (club && !club.same(me, white) && !club.same(me, black)) {
      return { ok: false, status: 403, error: 'Only players in this match can add its games.' }
    }
    let bracket: PlayoffBracket
    try {
      bracket = addGame(row.bracket, match, url)
    } catch (error) {
      return { ok: false, status: 409, error: (error as Error).message }
    }
    const updated = await db.update(playoffs).set({ bracket, revision: row.revision + 1 })
      .where(and(eq(playoffs.id, TOURNAMENT), eq(playoffs.revision, row.revision))).returning()
    if (updated.length) return { ok: true }
  }
  return { ok: false, status: 409, error: 'The bracket changed. Refresh and try again.' }
}
