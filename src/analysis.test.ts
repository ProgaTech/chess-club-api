import { describe, expect, test } from 'bun:test'
import { parseFinishedPgn, savedPgn } from './analysis-game'
import { analyze, renderReport } from './analysis-engine'

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
  test('exports per-ply board data and the interactive review prompt', async () => {
    const markdown = await analyze({ ...parseFinishedPgn('1. f3 e5 2. g4 Qh4# 0-1'), white: 'Shevik11', black: 'N0deJS' })
    expect(markdown).toContain('White: Shevik11\nBlack: N0deJS')
    const plies = JSON.parse(markdown.match(/```json\n([\s\S]+?)\n```/)![1])
    expect(plies).toHaveLength(4)
    expect(plies[3]).toMatchObject({ ply: 4, label: '2...', side: 'black', san: 'Qh4#', uci: 'd8h4', class: 'best',
      fenAfter: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' })
    expect(plies[2]).toMatchObject({ san: 'g4', class: 'blunder', lossCp: null })
    expect(plies[2].fenAfter).toBe(plies[3].fenBefore)
    expect(markdown).toContain('`game-review.html`')
    expect(markdown).toContain('Worst moves by Shevik11:\n\n- Ply 3, 2. g4, blunder')
    expect(markdown).toContain('Worst moves by N0deJS:\n\n- No inaccuracies.')
  })
  test('lists a sound engine sacrifice as brilliant, but not a losing one', () => {
    const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
    const sacrifice = (cp: number) => {
      const line = { score: { kind: 'cp' as const, value: cp }, uci: 'c4f7', moves: ['Bxf7+', 'Kxf7', 'Ng5+', 'Ke8'] }
      return { label: '4.', fen, after: fen, uci: 'c4f7', played: 'Bxf7+', best: line, actual: line, loss: 0 }
    }
    const game = { start: fen, moves: ['c4f7'], result: '1-0' }
    expect(renderReport(game, [sacrifice(120)])).toContain('"class":"brilliant"')
    expect(renderReport(game, [sacrifice(120)])).toContain('- Ply 1, 4. Bxf7+ (+1.20): Bxf7+ Kxf7 Ng5+ Ke8')
    expect(renderReport(game, [sacrifice(-200)])).toContain('"class":"best"')
  })
  test('preserves a Black-to-move custom start with promotion', async () => {
    const pgn = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/p5K1/8 b - - 0 37"]\n\n37... a1=Q 0-1'
    const markdown = await analyze(parseFinishedPgn(pgn))
    expect(markdown).toContain('37... a1=Q')
    expect(markdown).toContain('7k/8/8/8/8/8/p5K1/8 b - - 0 37')
  })
})
