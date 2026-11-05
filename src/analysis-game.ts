import { Chess } from 'chess.js'
import { decode } from '@savi2w/chess-tcn'

export const MAX_PLIES = 500
export const MAX_BYTES = 96 * 1024
export interface GameInput { start: string; moves: string[]; result: string; white?: string; black?: string }

export function parseFinishedPgn(pgn: string): GameInput {
  if (Buffer.byteLength(pgn) > MAX_BYTES) throw new Error('PGN exceeds 96 KiB.')
  // Ignore annotations when checking the final movetext marker against the Result tag.
  const clean = pgn.replace(/\{[^}]*\}|;[^\r\n]*/g, ' ').trim()
  const result = clean.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2)$/)?.[1]
  if (!result) throw new Error('Include the final result of a finished game.')
  const header = clean.match(/^\s*\[Result\s+"([^"]*)"\]/im)?.[1]
  if (header && header !== result) throw new Error('The PGN results disagree.')
  const chess = new Chess()
  chess.loadPgn(pgn)
  const variant = chess.getHeaders().Variant
  if (variant && !/^(standard|chess|normal)$/i.test(variant)) throw new Error('Only standard chess is supported.')
  if (chess.isCheckmate() && result !== (chess.turn() === 'w' ? '0-1' : '1-0')) throw new Error('Result disagrees with checkmate.')
  if ((chess.isStalemate() || chess.isInsufficientMaterial()) && result !== '1/2-1/2') throw new Error('Result disagrees with the drawn position.')
  const moves = chess.history({ verbose: true })
  if (!moves.length || moves.length > MAX_PLIES) throw new Error('Submit one game with 1 to 500 plies.')
  if (moves.some(m => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.lan) || m.from === m.to)) throw new Error('Illegal move.')
  return { start: moves[0].before, moves: moves.map(m => m.lan), result }
}

export function savedPgn(encoded: string, result: string, start?: string | null) {
  if (!encoded.length || encoded.length % 2 || encoded.length > MAX_PLIES * 2) throw new Error('Invalid saved moves.')
  const board = new Chess(start || undefined)
  for (let i = 0; i < encoded.length; i += 2) {
    board.move(decode(encoded.slice(i, i + 2)))
  }
  board.setHeader('Result', result)
  return board.pgn()
}
