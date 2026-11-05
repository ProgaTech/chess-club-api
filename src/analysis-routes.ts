import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from './db/client'
import { analyses, chessGames } from './db/schema'
import { sharedGameUrl } from './my-games'
import { lookupChessGame } from './chess-game-lookup'
import { chessGameRef } from './chess-game'
import { enqueue, runQueue } from './analysis-jobs'
import { MAX_BYTES, parseFinishedPgn, savedPgn } from './analysis-game'

async function matchGame(key: string) {
  const url = await sharedGameUrl(key)
  if (!url) return null
  const ref = chessGameRef(url)!
  const [stored] = await db.select().from(chessGames).where(and(eq(chessGames.provider,'chess.com'), eq(chessGames.externalId,ref.id), eq(chessGames.pace,ref.pace)))
  if (stored) {
    if (stored.status !== 'finished' || !/^(standard|normal|chess)$/i.test(stored.variant ?? 'standard')) return null
    if (stored.pgn) return stored.pgn
    const result = { white_win: '1-0', black_win: '0-1', draw: '1/2-1/2' }[stored.result]
    if (stored.encodedMoveList && result) return savedPgn(stored.encodedMoveList, result, stored.startingFen)
  }
  const details = await lookupChessGame(url)
  if (!details?.finishedStandard || !details.moveList || !details.result) return null
  return savedPgn(details.moveList, details.result, details.startFen)
}

export function analysisRoutes(userId: (c: Context) => string | null | undefined) {
  const routes = new Hono<{Variables:{owner:string}}>()
  routes.use('*', async (c,next) => {
    const owner = userId(c)
    if (!owner) return c.json({error:'Sign in to analyze a game.'},401)
    c.set('owner',owner)
    c.header('Cache-Control','private, no-store')
    await next()
  })
  routes.post('/', bodyLimit({maxSize: MAX_BYTES * 2, onError:c => c.json({error:'PGN is too large.'},413)}), async c => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || ('pgn' in body) === ('gameId' in body))
      return c.json({error:'Choose a saved game or paste one PGN.'},422)
    let pgn: string
    if ('gameId' in body) {
      if (typeof body.gameId !== 'string' || !/^(live|daily)-\d+$/.test(body.gameId)) return c.json({error:'Unknown game.'},404)
      const saved = await matchGame(body.gameId)
      if (!saved) return c.json({error:'Finished game unavailable. Try pasting its PGN.'},404)
      pgn = saved
    } else {
      if (typeof body.pgn !== 'string' || body.finishedConfirmed !== true) return c.json({error:'Paste a PGN and confirm the game has finished.'},422)
      pgn = body.pgn
    }
    if (Buffer.byteLength(pgn) > MAX_BYTES) return c.json({error:'PGN exceeds 96 KiB.'},413)
    let game
    try { game = parseFinishedPgn(pgn) }
    catch { return c.json({error:'Use one legal, finished standard PGN with a matching result and 1–500 plies.'},422) }
    const job = await enqueue(c.var.owner,game)
    if (!job) { c.header('Retry-After','10'); return c.json({error:'Two games are already processing. Try again in 10 seconds.'},429) }
    void runQueue()
    return c.json(job,202)
  })
  routes.get('/:id',async c => {
    const [job] = await db.select({id:analyses.id,status:analyses.status,done:analyses.done,total:analyses.total}).from(analyses)
      .where(and(eq(analyses.id,c.req.param('id')),eq(analyses.owner,c.var.owner)))
    if (!job) return c.json({error:'Review unavailable.'},404)
    return c.json({id:job.id,status:job.status,progress:{done:job.done,total:job.total},error:job.status === 'failed' ? 'analysis_failed' : null})
  })
  routes.get('/:id/report.md',async c => {
    const [job] = await db.select({markdown:analyses.markdown,status:analyses.status,id:analyses.id}).from(analyses)
      .where(and(eq(analyses.id,c.req.param('id')),eq(analyses.owner,c.var.owner)))
    if (!job) return c.json({error:'Review unavailable.'},404)
    if (job.status !== 'ready' || !job.markdown) return c.json({error:'Report is not ready.'},409)
    return c.body(job.markdown,200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="chess-analysis-' + job.id + '.md"'})
  })
  return routes
}
