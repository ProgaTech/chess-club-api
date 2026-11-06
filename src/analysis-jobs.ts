import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db/client'
import { analyses } from './db/schema'
import { analyze, PROFILE } from './analysis-engine'
import type { GameInput } from './analysis-game'

export async function enqueue(owner: string, input: GameInput) {
  const fingerprint = createHash('sha256').update(PROFILE + JSON.stringify(input)).digest('hex')
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner}))`)
    const [existing] = await tx.select({ id: analyses.id, status: analyses.status }).from(analyses)
      .where(and(eq(analyses.owner, owner), eq(analyses.fingerprint, fingerprint)))
    if (existing && existing.status !== 'failed') return existing
    const active = await tx.select({ id: analyses.id }).from(analyses)
      .where(and(eq(analyses.owner, owner), inArray(analyses.status, ['queued','running']))).limit(2)
    if (active.length >= 2) return null
    if (existing) {
      await tx.update(analyses).set({ status: 'queued', attempts: 0, done: 0, createdAt: new Date() }).where(eq(analyses.id, existing.id))
      return {id: existing.id, status: 'queued'}
    }
    const id = randomUUID()
    await tx.insert(analyses).values({ id, owner, fingerprint, input, total: input.moves.length })
    return {id, status: 'queued'}
  })
}

const available = sql`(status = 'queued' or (status = 'running' and lease < now()))`
const lease = sql`now() + interval '60 seconds'`
let busy = false

export async function runQueue() {
  if (busy) return
  busy = true
  try {
    while (true) {
      const job = await db.transaction(async tx => {
        const [row] = await tx.select().from(analyses).where(available)
          .orderBy(analyses.createdAt).limit(1).for('update', { skipLocked: true })
        if (!row) return
        const attempts = row.attempts + 1
        if (attempts > 2) {
          await tx.update(analyses).set({status:'failed', lease:null}).where(eq(analyses.id,row.id))
          return
        }
        await tx.update(analyses).set({status:'running', attempts, done:0, lease}).where(eq(analyses.id,row.id))
        return {...row, attempts}
      })
      if (!job) break
      const claim = and(eq(analyses.id, job.id), eq(analyses.attempts, job.attempts), eq(analyses.status, 'running'))
      try {
        const markdown = await analyze(job.input, async done => {
          const updated = await db.update(analyses).set({ done, lease }).where(claim).returning({id:analyses.id})
          if (!updated.length) throw new Error('Lease expired.')
        })
        await db.update(analyses).set({ markdown, status:'ready', lease:null }).where(claim)
      } catch {
        await db.update(analyses).set({status:job.attempts < 2 ? 'queued' : 'failed', lease:null}).where(claim)
      }
    }
  } catch (err) { console.error('Analysis queue unavailable:', err instanceof Error ? err.name : 'database error') }
  finally { busy = false }
}

export function startQueue() {
  void runQueue()
  setInterval(() => void runQueue(), 5000).unref()
  const cleanup = () => db.delete(analyses).where(sql`status in ('failed','ready') and created_at < now() - interval '7 days'`)
    .catch(() => console.error('Analysis cleanup unavailable'))
  void cleanup()
  setInterval(cleanup, 3600_000).unref()
}
