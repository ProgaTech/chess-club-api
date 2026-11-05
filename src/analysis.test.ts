import { describe, expect, test } from 'bun:test'
import { parseFinishedPgn, savedPgn } from './analysis-game'
import { analyze } from './analysis-engine'

describe('finished game review', () => {
  test('rejects ongoing, contradictory and multiple games', () => {
    for (const pgn of ['1. e4 *', '[Result "0-1"]\n\n1. e4 1-0', '1. e4 1-0 1. d4 0-1',
      '1. f3 e5 2. g4 Qh4# 1-0', '1. e5 1-0']) {
      expect(() => parseFinishedPgn(pgn)).toThrow()
    }
  })
  test('restores a saved game with its final result', () => {
    expect(parseFinishedPgn(savedPgn('mC0S','1-0')).moves).toEqual(['e2e4','e7e6'])
  })
  test('marks a forced mate against White and exports only normalized game data', async () => {
    const game = parseFinishedPgn('[White "Private name"]\n\n1. f3 {private comment} e5 2. g4 Qh4# 0-1')
    const markdown = await analyze(game)
    expect(markdown).toContain('### 2. g4')
    expect(markdown).toContain('(Black mates in 1): g4 Qh4#')
    expect(markdown).not.toContain('Private name')
    expect(markdown).not.toContain('private comment')
  })
  test('preserves a Black-to-move custom start with promotion', async () => {
    const pgn = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/p5K1/8 b - - 0 37"]\n\n37... a1=Q 0-1'
    const markdown = await analyze(parseFinishedPgn(pgn))
    expect(markdown).toContain('37... a1=Q')
    expect(markdown).toContain('7k/8/8/8/8/8/p5K1/8 b - - 0 37')
  })
})
