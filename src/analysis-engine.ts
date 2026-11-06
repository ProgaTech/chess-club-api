import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { Chess } from 'chess.js'
import type { GameInput } from './analysis-game'

export const PROFILE = 'Stockfish 18 Lite / 8000 nodes / Markdown v8'
const script = createRequire(import.meta.url).resolve('stockfish/src/stockfish-18-lite-single.js')
type Score = { kind: 'cp' | 'mate'; value: number }
type Line = { score: Score; uci: string; moves: string[] }
type Row = { label: string; fen: string; after: string; uci: string; played: string; best: Line; actual: Line; loss: number }

const PROMPT = [
  'You are a chess coach for club players. Build one self-contained HTML file, `game-review.html`, that replays this game on an interactive board and explains every move. Use only the evidence in this file.',
  '',
  'Data',
  '- Embed the Board data array verbatim as a JavaScript constant. Never change its moves, FENs or scores. Every position shown must come from `fenBefore` or `fenAfter`; before ply 1, show the starting FEN.',
  '- Keep your own explanations in a separate object keyed by `ply`.',
  '',
  'Board',
  '- Draw an 8×8 board with HTML/CSS or inline SVG, and pieces as inline SVG or Unicode. Use no external scripts, fonts, images or network requests; the file must work offline when opened directly.',
  '- Show White at the bottom, with a Flip button. Label files and ranks.',
  '- Animate each move: slide the piece from the first to the second square of `uci` in about 250 ms. Also move the rook when castling, remove a pawn captured en passant and show the promoted piece. After the animation, render exactly `fenAfter`. Stepping backwards may jump without animation.',
  '- Highlight the squares of the current move. When `bestUci` differs from `uci`, draw an arrow for the engine’s choice.',
  '',
  'Navigation',
  '- Buttons for start, previous, next, end and play/pause (autoplay about 1.5 s per move). Keyboard: ←, →, Home, End and Space.',
  '- A move list in two columns by move number. Clicking a move jumps to it. Mark each move with its class, and keep the current one highlighted and scrolled into view.',
  '- An evaluation bar beside the board and an evaluation graph of `playedScore` across the game; clicking the graph jumps to that ply. Clamp centipawns to ±10 pawns for display and fill the bar for mate scores.',
  '- A Highlights panel, always one click away (for example a tab beside the move list), listing the brilliant moves and each player’s worst moves from the Highlights section with the player, move and score change. Show every group at once with no inner scrolling, with the two players’ lists side by side on wide screens, so neither player’s list is hidden. Title the brilliant group "Brilliant moves (переписати це на раст)" and each player’s worst-moves group "Worst moves (ну це штанга) · " followed by the player’s nickname; keep the bracketed phrases as written in any language. Clicking an entry jumps to that ply. Mark these plies on the evaluation graph and in the move list with !!, ??, ? and ?!.',
  '',
  'Move panel, updated on every step',
  '- Move label and SAN, a coloured badge for `class` (brilliant, best, good, inaccuracy, mistake, blunder), the score after the move, the engine’s choice with its score, and the difference in pawns from `lossCp` (when it is null, say the move missed or allowed a forced mate).',
  '- The played continuation `playedLine` and the engine continuation `bestLine`, in SAN.',
  '- Your explanation: 1–3 sentences for an ordinary move. For each critical moment and highlight above, a fuller paragraph on the plan, the tactical idea and what went wrong, or for a brilliant move what the sacrifice achieves. Base every claim on the supplied lines and scores, cite moves like "23... Nf4", and say when the evidence is insufficient instead of guessing.',
  '- At the starting position, a 3–5 sentence summary of the game: result, turning points and how it was decided.',
  '',
  'Language',
  '- Write the explanations in the language the user writes to you in. When the White and Black nicknames are given above, show them by the board and use them in the explanations; otherwise say White and Black. Do not invent player names, ratings, evaluations or moves.',
  '',
  'Design: a calm, editorial review in deep green and cream. Follow it closely; exact pixels may vary.',
  '- Colours as CSS variables. Light: background #f3f4f0, cards #ffffff, text #192923, muted #56675f, borders #d5ded7, accent #236d52. Dark: background #111c17, cards #1b2922, text #e7eee8, muted #a4b5aa, borders #34483b, accent #8dc8a6. Follow the system theme and add an Auto / Light / Dark selector in the header.',
  '- Type: the system UI font at 16px with line height 1.55. Section labels are small uppercase "eyebrows": 12px, bold, letter spacing 0.15em, in the accent colour.',
  '- Header: an eyebrow such as "A game in review · 51 moves", a short headline of a few words that captures the story of the game, and a muted subtitle with the winner, the result and the opening.',
  '- Layout: a centred page up to about 1260px wide with two columns of cards (white or dark-green background, 1px border, 16px radius, 22px padding, no heavy shadows). Left card: players, board, controls, evaluation graph and a row of small buttons that jump to the highlights. Right card: the move panel, then tabs for the move list and Highlights. One column below 800px.',
  '- Board: cream (#e8e5d6) and sage (#789385) squares, bold coordinates in the corners, a translucent yellow tint on the last move and an orange (#df8a16) engine arrow. Unicode pieces: White cream with a dark outline, Black near-black with a light outline. Beside it, a 25px evaluation bar: dark with a cream fill and the score at the top.',
  '- Controls: a centred row of small bordered buttons (|←, ←, Play/Pause, →, →|, Flip) that disable at the ends of the game.',
  '- Evaluation graph: a thin accent-coloured line on a transparent background with a centre line, dashed guides at ±10, coloured dots on highlighted plies and an orange marker for the current ply; labels in small muted text.',
  '- Move panel: an eyebrow with the player, side and ply; the move as a heading followed by a pill badge with a soft tint per class (teal brilliant, green best, grey-green good, amber inaccuracy, orange mistake, red blunder); two stat blocks separated by thin top borders (score after the move, engine choice before it); the loss in muted text; the explanation in a block with a 3px accent left border; both variations numbered and monospaced on a tinted background.',
  '- Move list: a compact scrollable grid with a muted move-number column and two move buttons per row, each with a small dot coloured by class and the !!, ??, ? or ?! mark; the current move is filled with the accent colour and kept in view.',
  '- A small muted footer naming the engine profile and noting that the page works offline. Respect prefers-reduced-motion.',
  '',
  'Output the complete HTML file in one code block, or as a downloadable file if you can create files.',
]

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

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const isWhite = (r: Row) => !r.label.endsWith('...')

function balance(fen: string, white: boolean) {
  let sum = 0
  for (const c of fen.split(' ')[0]) if (VALUES[c.toLowerCase()] !== undefined) sum += VALUES[c.toLowerCase()] * ((c === c.toUpperCase()) === white ? 1 : -1)
  return sum
}

// An engine-approved move that is still at least two points down after the reply and the next pair of moves.
function brilliant(r: Row) {
  const white = isWhite(r)
  const sign = white ? 1 : -1
  const { score, moves } = r.actual
  if (r.best.uci !== r.uci || moves.length < 2) return false
  if (score.kind === 'mate' ? score.value * sign < 0 : score.value * sign < -50 || sign * r.best.score.value > 500) return false
  const line = new Chess(r.fen)
  const start = balance(r.fen, white)
  const after: number[] = []
  for (const san of moves.slice(0, 4)) { line.move(san); after.push(balance(line.fen(), white)) }
  return [after[1], after[Math.min(3, after.length - 1)]].every(b => b <= start - 2)
}

function verdict(r: Row) {
  if (brilliant(r)) return 'brilliant'
  if (r.best.uci === r.uci) return 'best'
  if (r.loss >= 300) return 'blunder'
  if (r.loss >= 100) return 'mistake'
  return r.loss >= 50 ? 'inaccuracy' : 'good'
}

function boardData(rows: Row[]) {
  const score = (s: Score) => ({ ...s, text: display(s) })
  return rows.map((r, i) => JSON.stringify({
    ply: i + 1, label: r.label, side: isWhite(r) ? 'white' : 'black', san: r.played, uci: r.uci,
    fenBefore: r.fen, fenAfter: r.after, class: verdict(r), lossCp: r.loss >= 100000 ? null : r.loss,
    playedScore: score(r.actual.score), playedLine: r.actual.moves,
    bestSan: r.best.moves[0], bestUci: r.best.uci, bestScore: score(r.best.score), bestLine: r.best.moves,
  })).join(',\n')
}

function highlights(game: GameInput, rows: Row[]) {
  const entry = (r: Row) => '- Ply ' + (rows.indexOf(r) + 1) + ', ' + r.label + ' ' + r.played
  const text = ['## Highlights', '', 'Brilliant moves: the engine’s first choice, giving up at least two points of material without losing the position.', '']
  const brilliants = rows.filter(brilliant)
  if (!brilliants.length) text.push('- None found.')
  for (const r of brilliants) text.push(entry(r) + ' (' + display(r.actual.score) + '): ' + r.actual.moves.join(' '))
  for (const [white, name] of [[true, game.white ?? 'White'], [false, game.black ?? 'Black']] as const) {
    text.push('', 'Worst moves by ' + name + ':', '')
    const worst = rows.filter(r => isWhite(r) === white && r.loss >= 50)
      .sort((a,b) => b.loss - a.loss).slice(0,3)
    if (!worst.length) text.push('- No inaccuracies.')
    for (const r of worst) text.push(entry(r) + ', ' + verdict(r) + ', ' + display(r.best.score) + ' → ' + display(r.actual.score) + ' (engine: ' + r.best.moves[0] + ')')
  }
  return [...text, '']
}

export function renderReport(game: GameInput, rows: Row[]) {
  const players = game.white && game.black ? ['White: ' + game.white, 'Black: ' + game.black, ''] : []
  const text = ['# Finished game analysis', '', PROFILE, '', ...players, 'Result: ' + game.result, '','Starting FEN: `' + game.start + '`', '',
    '## Game', '', rows.map(r => r.label + ' ' + r.played).join(' ') + ' ' + game.result, '',
    'Scores use pawn units from White’s perspective. Positive favors White. Mate scores name the winning side.', '',
    ...highlights(game, rows), '## Critical moments', '']
  const moments = rows.filter(r => r.loss >= 100).sort((a,b) => b.loss - a.loss).slice(0,5)
  if (!moments.length) text.push('No move crossed the one-pawn or forced-mate threshold.', '')
  for (const r of moments) text.push('### ' + r.label + ' ' + r.played, '', 'Position before the move: `' + r.fen + '`', '',
    '- Played move, engine continuation (' + display(r.actual.score) + '): ' + r.actual.moves.join(' '),
    '- Engine choice and continuation (' + display(r.best.score) + '): ' + r.best.moves.join(' '), '')
  text.push('## Move-by-move evidence', '', '| Move | Played | Played score | Engine choice | Best score |', '| --- | --- | --- | --- | --- |')
  for (const r of rows) text.push('| ' + [r.label,r.played,display(r.actual.score),r.best.moves[0],display(r.best.score)].join(' | ') + ' |')
  text.push('', '## Board data', '',
    'One object per ply. Scores are from White’s perspective: `cp` in centipawns, `mate` in moves. `lossCp` is how many centipawns the move gave up against the engine’s choice.', '',
    '```json', '[', boardData(rows), ']', '```')
  return [...text, '', '## Prompt for your LLM', '', ...PROMPT, ''].join('\n')
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
      return { uci: best, moves, score: { kind: match[1] as Score['kind'], value: Number(match[2]) * (board.turn() === 'w' ? 1 : -1) } }
    }
    for (const move of game.moves) {
      const fen = board.fen()
      const white = board.turn() === 'w'
      const best = await search()
      const san = new Chess(fen).move(move).san
      const actual = best.moves[0] === san ? best : await search(move)
      board.move(move)
      rows.push({ fen, after: board.fen(), uci: move, label: fen.split(' ')[5] + (white ? '.' : '...'), played: san, best, actual, loss: moverLoss(best.score, actual.score, white ? 1 : -1) })
      history.push(move)
      await progress(history.length)
    }
    return renderReport(game, rows)
  } finally { clearTimeout(timeout); reader.close(); child.kill() }
}
