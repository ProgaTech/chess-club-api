import { clerkMiddleware, getAuth } from '@clerk/hono'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { getMyAccount, listAccounts, saveMyAccount } from './accounts'
import { readBoard } from './board'
import { addDrawGame, listDraws, saveDraw } from './draws'
import { generateNextRound, previewNextRound } from './next-round'
import type { DrawMode, IKeptPair } from './next-round'
import { listMyGames } from './my-games'
import { getPlayer } from './players'
import { readAutumnBoard } from './autumn'
import { sortMembers, toMember } from './members'
import { roleOf } from './roles'
import type { IActor, Role } from './roles'

const app = new Hono()

const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY,
)

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
]

app.use(
  '*',
  cors({
    origin: allowedOrigins,
    allowHeaders: ['Authorization', 'Content-Type', 'X-View-As'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
)

if (clerkConfigured) {
  app.use(
    '*',
    clerkMiddleware({
      authorizedParties: allowedOrigins,
    }),
  )
}

app.get('/', (c) => {
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const user = await c.get('clerk').users.getUser(userId)
  return c.json(toMember(user))
})

app.get('/members', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const { data } = await c.get('clerk').users.getUserList({ limit: 100 })
  return c.json({ members: sortMembers(data.map(toMember), userId) })
})

app.get('/accounts', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ accounts: await listAccounts() })
})

app.get('/accounts/me', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const [account, roles] = await Promise.all([getMyAccount(userId), readRoles(c, userId)])
  return c.json({ account, role: roles.effective, canViewAsMember: roles.actual === 'organizer' })
})

app.put('/accounts/me', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Send name and surname.' }, 400)
  }

  const result = await saveMyAccount(userId, body)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }

  return c.json(result.account)
})

app.get('/accounts/me/games', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const account = await getMyAccount(userId)
  if (!account) {
    return c.json({ games: [] })
  }

  return c.json({ games: await listMyGames(account) })
})

app.get('/players/:name', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const player = await getPlayer(c.req.param('name'))
  if (!player) {
    return c.json({ error: 'That player is not in the club.' }, 404)
  }

  return c.json({ player })
})

app.get('/board', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json(await readBoard())
})

app.get('/draws', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ draws: await listDraws() })
})

app.post('/draws', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if ((await readActor(c, userId)).role !== 'organizer') {
    return c.json({ error: 'Only the organizer can do that.' }, 403)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Send the pairs.' }, 400)
  }

  const result = await saveDraw(body)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }

  return c.json(result.draw, 201)
})

app.post('/draws/next', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if ((await readActor(c, userId)).role !== 'organizer') {
    return c.json({ error: 'Only the organizer can do that.' }, 403)
  }

  const request = await readNextRound(c)
  if (!request) {
    return c.json({ error: 'Send the round number.' }, 400)
  }

  const result = await generateNextRound(request.round, request.kept, request.mode)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }
  if ('confirm' in result) {
    return c.json({ round: request.round, rematch: true, pairs: result.confirm })
  }

  return c.json({ round: request.round, draw: result.draw, pairs: result.pairs }, 201)
})

app.post('/draws/preview', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const round = await readRound(c)
  if (round === null) {
    return c.json({ error: 'Send the round number.' }, 400)
  }

  const result = await previewNextRound(round)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }

  return c.json({ round: result.round, pairs: result.pairs })
})

app.post('/draws/:id/games', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const drawId = Number(c.req.param('id'))
  if (!Number.isInteger(drawId)) {
    return c.json({ error: 'That draw was not found.' }, 400)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Send the match and a Chess.com game link.' }, 400)
  }

  const result = await addDrawGame(drawId, body, await readActor(c, userId))
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }

  return c.json(result.draw)
})

app.get('/tournaments/autumn-2026', async (c) => {
  if (!clerkConfigured) {
    return c.json({ error: 'Clerk is not configured on the API' }, 503)
  }

  const { userId } = getAuth(c)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json(await readAutumnBoard())
})

async function readRound(c: Context): Promise<number | null> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return null
  }
  if (!isRecord(body) || typeof body.round !== 'number') {
    return null
  }
  return body.round
}

async function readNextRound(c: Context): Promise<{ round: number; kept: IKeptPair[] | null; mode: DrawMode } | null> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return null
  }
  if (!isRecord(body) || typeof body.round !== 'number') {
    return null
  }
  if (body.mode !== undefined && body.mode !== 'score' && body.mode !== 'random') {
    return null
  }
  const mode: DrawMode = body.mode === 'random' ? 'random' : 'score'
  if (body.pairs === undefined) {
    return { round: body.round, kept: null, mode }
  }
  if (!Array.isArray(body.pairs)) {
    return null
  }
  const kept: IKeptPair[] = []
  for (const pair of body.pairs) {
    if (!isRecord(pair) || typeof pair.white !== 'string' || (pair.black !== null && typeof pair.black !== 'string')) {
      return null
    }
    kept.push({ white: pair.white, black: pair.black })
  }
  return { round: body.round, kept, mode }
}

async function readActor(c: Context, userId: string): Promise<IActor> {
  return { clerkUserId: userId, role: (await readRoles(c, userId)).effective }
}

// An organizer can send X-View-As: member to test the site as a member. The header only ever lowers a role.
async function readRoles(c: Context, userId: string): Promise<{ actual: Role; effective: Role }> {
  const user = await c.get('clerk').users.getUser(userId)
  const actual = roleOf(user)
  const effective = actual === 'organizer' && c.req.header('X-View-As') === 'member' ? 'member' : actual
  return { actual, effective }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const port = Number(process.env.PORT ?? 3000)

export default {
  port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
  idleTimeout: 60,
}
