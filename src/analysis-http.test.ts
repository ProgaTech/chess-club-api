import { expect, test } from 'bun:test'

// Opt in only against a disposable local database. Importing the DB client applies migrations.
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const isolated = process.env.TEST_ANALYSIS_DB === '1' && url?.hostname === '127.0.0.1' && url.port === '55437'

test.skipIf(!isolated)('private job submission, saved game, deduplication and stable Markdown download', async () => {
  const { analysisRoutes } = await import('./analysis-routes')
  const { db } = await import('./db/client')
  const { chessGames, draws } = await import('./db/schema')
  const owner = crypto.randomUUID()
  const gameId = String(Date.now())
  const player = 'Test ' + owner
  const app = analysisRoutes(c => c.req.header('x-test-user'))
  const pgn = '1. e4 e6 1-0'
  const post = (data: unknown) => app.request('/', { method:'POST', headers:{'x-test-user':owner,'Content-Type':'application/json'}, body:JSON.stringify(data) })
  const get = (path:string,user: string = owner) => app.request(path,{headers:{'x-test-user':user}})
  expect((await app.request('/missing')).status).toBe(401)
  expect((await post({pgn})).status).toBe(422)
  expect((await post({gameId:'live-999999999990'})).status).toBe(404)
  await db.insert(draws).values({result:{pairs:[{white:player,black:'Opponent',games:['https://www.chess.com/game/live/' + gameId]}]}})
  await db.insert(chessGames).values({provider:'chess.com',externalId:gameId,pace:'live',status:'finished',result:'white_win',termination:'resignation',parserVersion:'test',encodedMoveList:'mC0S'})
  const [saved, pasted] = await Promise.all([post({gameId:'live-' + gameId}), post({pgn,finishedConfirmed:true})])
  expect(saved.status).toBe(202)
  expect(pasted.status).toBe(202)
  const {id} = await saved.json()
  expect((await pasted.json()).id).toBe(id)
  const file = '/' + id + '/report.md'
  expect((await get(file,'other')).status).toBe(404)
  expect((await get('/' + id,'other')).status).toBe(404)
  for (let i=0; i<100; i++) {
    const status = await (await get('/' + id)).json()
    expect(status.status).not.toBe('failed')
    if (status.status === 'ready') break
    await Bun.sleep(100)
  }
  const report = await get(file)
  expect(report.status).toBe(200)
  expect(report.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
  expect(report.headers.get('Content-Disposition')).toContain('chess-analysis-' + id + '.md')
  const body = await report.text()
  expect(body).toContain('1. e4 1... e6 1-0')
  expect(await (await get(file)).text()).toBe(body)
},20000)
