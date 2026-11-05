import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { Chess } from 'chess.js'
import type { GameInput } from './analysis-game'

export const PROFILE = 'Stockfish 18 Lite / 8000 nodes / Markdown v1'
const script = createRequire(import.meta.url).resolve('stockfish/src/stockfish-18-lite-single.js')
type Score = { kind: 'cp' | 'mate'; value: number }
type Line = { score: Score; moves: string[] }
type Row = { label: string; fen: string; played: string; best: Line; actual: Line; loss: number }

function display(score: Score) {
  if (score.kind === 'mate') return (score.value > 0 ? 'White' : 'Black') + ' mates in ' + Math.abs(score.value)
  return (score.value > 0 ? '+' : '') + (score.value / 100).toFixed(2)
}

function moverLoss(best: Score, played: Score, sign: number) {
  const category = (s: Score) => s.kind === 'mate' ? Math.sign(s.value) * sign : 0
  const transition = category(best) - category(played)
  if (transition > 0) return 100000 * transition
  if (best.kind === 'cp' && played.kind === 'cp') return sign * (best.value - played.value)
  return 0
}

export function renderReport(game: GameInput, rows: Row[]) {
  const text = ['# Finished game analysis', '', PROFILE, '', 'Result: ' + game.result, '','Starting FEN: `' + game.start + '`', '',
    '## Game', '', rows.map(r => r.label + ' ' + r.played).join(' ') + ' ' + game.result, '',
    'Scores use pawn units from White’s perspective. Positive favors White. Mate scores name the winning side.', '',
    '## Critical moments', '']
  const moments = rows.filter(r => r.loss >= 100).sort((a,b) => b.loss - a.loss).slice(0,5)
  if (!moments.length) text.push('No move crossed the one-pawn or forced-mate threshold.', '')
  for (const r of moments) text.push('### ' + r.label + ' ' + r.played, '', 'Position before the move: `' + r.fen + '`', '',
    '- Played move, engine continuation (' + display(r.actual.score) + '): ' + r.actual.moves.join(' '),
    '- Engine choice and continuation (' + display(r.best.score) + '): ' + r.best.moves.join(' '), '')
  text.push('## Move-by-move evidence', '', '| Move | Played | Played score | Engine choice | Best score |', '| --- | --- | --- | --- | --- |')
  for (const r of rows) text.push('| ' + [r.label,r.played,display(r.actual.score),r.best.moves[0],display(r.best.score)].join(' | ') + ' |')
  return [...text, '', '## Prompt for your LLM', '', 'Explain the critical moments to a club player using the supplied scores and lines. Cite move numbers. Say when the evidence is insufficient.', ''].join('\n')
}

export async function analyze(game: GameInput, progress: (done: number) => Promise<void> = async () => {}) {
  const child = spawn('node', [script], { stdio: ['pipe','pipe','ignore'], windowsHide: true })
  child.stdin.on('error', () => {})
  const reader = createInterface({ input: child.stdout })
  const lines = reader[Symbol.asyncIterator]()
  const timeout = setTimeout(() => child.kill(), 10 * 60_000)
  child.on('error', () => reader.close())
  async function until(end: string, inspect?: (s: string) => void) {
    const deadline = setTimeout(() => child.kill(), 20000)
    try {
      while (true) {
        const {value, done} = await lines.next()
        if (done) throw new Error('Stockfish stopped before finishing.')
        if (value.split(' ')[0] === end) return value
        inspect?.(value)
      }
    } finally { clearTimeout(deadline) }
  }
  const send = (s: string) => child.stdin.write(s + '\n')
  try {
    send('uci')
    await until('uciok')
    send('isready')
    await until('readyok')
    const board = new Chess(game.start)
    const history: string[] = []
    const rows: Row[] = []
    async function search(forced?: string): Promise<Line> {
      send('position fen ' + game.start + (history.length ? ' moves ' + history.join(' ') : ''))
      send('go nodes 8000' + (forced ? ' searchmoves ' + forced : ''))
      let info = ''
      const best = (await until('bestmove', s => { if (/ score (cp|mate) -?\d+ .*\bpv /.test(s)) info = s })).split(' ')[1]
      const match = info.match(/ score (cp|mate) (-?\d+) .*?\bpv (.+)$/)
      if (!match || (forced && best !== forced)) throw new Error('Incomplete engine evidence.')
      const replay = new Chess(board.fen())
      const pv = match[3].trim().split(/\s+/)
      if (pv[0] !== best) throw new Error('Inconsistent engine variation.')
      const moves = pv.slice(0,8).map(m => replay.move(m).san)
      return { moves, score: { kind: match[1] as Score['kind'], value: Number(match[2]) * (board.turn() === 'w' ? 1 : -1) } }
    }
    for (const move of game.moves) {
      const fen = board.fen()
      const white = board.turn() === 'w'
      const best = await search()
      const san = new Chess(fen).move(move).san
      const actual = best.moves[0] === san ? best : await search(move)
      rows.push({ fen, label: fen.split(' ')[5] + (white ? '.' : '...'), played: san, best, actual, loss: moverLoss(best.score, actual.score, white ? 1 : -1) })
      board.move(move)
      history.push(move)
      await progress(history.length)
    }
    return renderReport(game, rows)
  } finally { clearTimeout(timeout); reader.close(); child.kill() }
}
