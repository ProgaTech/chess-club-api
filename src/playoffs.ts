import { randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { readBoard } from './board'
import { db } from './db/client'
import { playoffs } from './db/schema'
import { qualification, recordWinner } from './playoff-bracket'
import type { MatchId, PlayoffBracket } from './playoff-bracket'

const TOURNAMENT = 'autumn-2026'

export async function readPlayoffs() {
  const [board, rows] = await Promise.all([
    readBoard(), db.select().from(playoffs).where(eq(playoffs.id, TOURNAMENT)),
  ])
  return { ...qualification(board.standings), saved: rows[0] ?? null }
}

type Result = { ok: true } | { ok: false; status: 400 | 409; error: string }

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
