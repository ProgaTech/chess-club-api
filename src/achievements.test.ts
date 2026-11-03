import { describe, expect, test } from 'bun:test'
import { encode } from '@savi2w/chess-tcn'
import { Chess } from 'chess.js'
import { achievementsFrom } from './achievements'
import { aliasMap, scorePair } from './match-score'
import type { IBoardDraw, IScoreGameInput } from './match-score'

const whiteAhead = ['e4', 'd5', 'exd5', 'Nf6']
const blackAhead = ['e4', 'd5', 'Nf3', 'dxe4']

describe('best recovery', () => {
  for (const winner of ['white', 'black'] as const) {
    for (const swapped of [false, true]) {
      const colors = swapped ? 'swapped pairing colors' : 'matching pairing colors'

      test(`does not count ${winner}'s material advantage with ${colors}`, () => {
        const moves = winner === 'white' ? whiteAhead : blackAhead
        const draws = boardWithGame(moves, winner, swapped)
        expect(achievementsFrom(draws, []).recovery).toEqual([])
      })

      test(`counts ${winner}'s actual deficit with ${colors}`, () => {
        const moves = winner === 'white' ? blackAhead : whiteAhead
        const draws = boardWithGame(moves, winner, swapped)
        const winnerName = (winner === 'white') !== swapped ? 'Ada' : 'Bea'
        expect(achievementsFrom(draws, []).recovery).toEqual([
          expect.objectContaining({
            names: [winnerName],
            opponent: winnerName === 'Ada' ? 'Bea' : 'Ada',
            deficit: 1,
            current: true,
          }),
        ])
      })
    }

    test(`uses the ${winner} result when winner metadata is missing`, () => {
      const moves = winner === 'white' ? blackAhead : whiteAhead
      const draws = boardWithGame(moves, winner, true, null)
      expect(achievementsFrom(draws, []).recovery).toEqual([
        expect.objectContaining({ names: [winner === 'white' ? 'Bea' : 'Ada'], deficit: 1 }),
      ])
    })
  }
})

function boardWithGame(
  moves: string[],
  winner: 'white' | 'black',
  swapped: boolean,
  winnerMetadata: IScoreGameInput['winner'] = winner,
): IBoardDraw[] {
  const chess = new Chess()
  const moveList = moves.map((san) => encode(chess.move(san))).join('')
  const aliases = aliasMap([
    { username: 'ada_chess', name: 'Ada' },
    { username: 'bea_chess', name: 'Bea' },
  ])
  const pair = scorePair(
    {
      white: 'Ada',
      black: 'Bea',
      across: false,
      skipped: false,
      games: [
        {
          url: 'https://www.chess.com/game/live/1',
          whiteUsername: swapped ? 'bea_chess' : 'ada_chess',
          blackUsername: swapped ? 'ada_chess' : 'bea_chess',
          winner: winnerMetadata,
          result: winner === 'white' ? '1-0' : '0-1',
          playedAt: '2026-10-23T12:00:00.000Z',
          moveList,
          summary: null,
          opening: null,
        },
      ],
    },
    aliases,
  )
  return [{ id: 1, round: 1, createdAt: '2026-10-23T11:00:00.000Z', pairs: [pair] }]
}
