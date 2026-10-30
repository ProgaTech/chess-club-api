import { describe, expect, test } from 'bun:test'
import { materialSwingFromSans, settledMaterialDeficit } from './material-swing'
import type { ISwingStep } from './material-swing'
import { gameStandingsFrom } from './game-table'
import type { IClubGameRow } from './game-table'
import { revealPairs } from './reveal'
import { swissPairs } from './swiss'
import type { ISwissPair, ISwissPlayer } from './swiss'

describe('recovery', () => {
  test('ignores a queen trade that is recaptured on the next move', () => {
    const steps: ISwingStep[] = [
      { balance: -9, captured: true, to: 'd4' },
      { balance: 0, captured: true, to: 'd4' },
    ]
    expect(settledMaterialDeficit(steps)).toBe(0)
  })

  test('keeps the position after an unequal recapture', () => {
    const steps: ISwingStep[] = [
      { balance: -9, captured: true, to: 'd4' },
      { balance: -4, captured: true, to: 'd4' },
    ]
    expect(settledMaterialDeficit(steps)).toBe(-4)
  })

  test('keeps a deficit that is still there on the next move', () => {
    const steps: ISwingStep[] = [
      { balance: -9, captured: true, to: 'd4' },
      { balance: -9, captured: false, to: 'e5' },
    ]
    expect(settledMaterialDeficit(steps)).toBe(-9)
  })

  test('a knight trade in the Ruy does not count as a comeback', () => {
    const swing = materialSwingFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6'], 'black')
    expect(swing?.deficit).toBe(0)
  })
})

describe('domestic elo', () => {
  test('a win against an equal opponent gains 16 points at K=32', () => {
    const games: IClubGameRow[] = [
      {
        url: 'https://www.chess.com/game/live/1',
        white: 'Ada',
        black: 'Bea',
        outcome: 'white',
        winnerName: 'Ada',
        playedAt: '2026-10-18T12:00:00.000Z',
        opening: null,
        round: 1,
      },
    ]
    const standings = gameStandingsFrom(games)
    const ada = standings.find((row) => row.name === 'Ada')
    const bea = standings.find((row) => row.name === 'Bea')
    expect(ada?.elo).toBe(1216)
    expect(bea?.elo).toBe(1184)
    expect(ada?.points).toBe(1)
    expect(bea?.points).toBe(0)
  })
})

describe('swiss', () => {
  test('pairs the score groups and gives white to the higher player', () => {
    const pairs = swissPairs(
      [player('Ada', 1), player('Bea', 1), player('Cid', 0), player('Dee', 0)],
      keepOrder,
    )
    expect(pairs.map(label)).toEqual(['Ada–Bea', 'Cid–Dee'])
  })

  test('a tied score group is shuffled, so the last name is not the one who plays down', () => {
    const rolls = [0, 0.5]
    let cursor = 0
    const pairs = swissPairs(
      [player('Ada', 1), player('Bea', 1), player('Cid', 1), player('Dee', 0)],
      () => rolls[cursor++] ?? 0,
    )
    expect(pairs.map(label)).toEqual(['Cid–Bea', 'Ada–Dee'])
  })

  test('extra game wins stay inside the score group', () => {
    const vlad = player('Vlad', 0)
    vlad.gameWins = 4
    const pairs = swissPairs([player('Ada', 1), player('Bea', 1), vlad, player('Dee', 0)], keepOrder)
    expect(pairs.map(label)).toEqual(['Ada–Bea', 'Dee–Vlad'])
  })

  test('an odd group plays down against a random player with the most game wins', () => {
    const bea = player('Bea', 1)
    bea.gameWins = 1
    const cid = player('Cid', 1)
    cid.gameWins = 3
    const dee = player('Dee', 1)
    dee.gameWins = 3
    let cursor = 0
    const pairs = swissPairs([player('Ada', 2), bea, cid, dee], () => {
      cursor += 1
      return cursor === 1 ? 0 : 0.999999999999
    })
    expect(pairs.map(label)).toEqual(['Ada–Cid', 'Bea–Dee'])
    expect(pairs[0]?.kind).toBe('down')
    expect(pairs[0]?.reason).toContain('most game wins')
  })

  test('flips colors when a score group has to rematch', () => {
    const ada = player('Ada', 1)
    ada.whites = 1
    ada.lastColor = 'white'
    ada.opponents = ['bea']
    const bea = player('Bea', 1)
    bea.blacks = 1
    bea.lastColor = 'black'
    bea.opponents = ['ada']
    const cid = player('Cid', 0)
    cid.whites = 1
    cid.lastColor = 'white'
    cid.opponents = ['dee']
    const dee = player('Dee', 0)
    dee.blacks = 1
    dee.lastColor = 'black'
    dee.opponents = ['cid']

    const pairs = swissPairs([ada, bea, cid, dee], keepOrder)
    expect(pairs.map(label)).toEqual(['Bea–Ada', 'Dee–Cid'])
  })

  test('the lowest player without a bye sits out an odd field', () => {
    const ada = player('Ada', 1)
    ada.hadBye = true
    const pairs = swissPairs([ada, player('Bea', 1), player('Cid', 0)], keepOrder)
    expect(pairs.map(label)).toEqual(['Ada–Bea', 'Cid'])
  })
})

function keepOrder(): number {
  return 0.999999999999
}

function player(name: string, points: number): ISwissPlayer {
  return {
    name,
    points,
    gameWins: 0,
    whites: 0,
    blacks: 0,
    lastColor: null,
    opponents: [],
    hadBye: false,
  }
}

function label(pair: { white: string; black: string | null }): string {
  return pair.black ? `${pair.white}–${pair.black}` : pair.white
}

describe('reveal pairs', () => {
  const planned: ISwissPair[] = [
    {
      white: 'Ada',
      black: 'Ben',
      kind: 'down',
      rematch: true,
      reason: '',
      whitePlayer: { name: 'Ada', points: 2, gameWins: 4 },
      blackPlayer: { name: 'Ben', points: 1.5, gameWins: 3 },
    },
    {
      white: 'Cleo',
      black: null,
      kind: 'bye',
      rematch: false,
      reason: '',
      whitePlayer: { name: 'Cleo', points: 0, gameWins: 0 },
      blackPlayer: null,
    },
  ]

  test('gives kept pairs the points the round was drawn from', () => {
    const kept = [
      { white: 'Ben', black: 'ada', games: [] },
      { white: 'Cleo', black: null, games: [] },
    ]
    expect(revealPairs(kept, planned)).toEqual([
      { white: { name: 'Ben', points: 1.5, gameWins: 3 }, black: { name: 'Ada', points: 2, gameWins: 4 } },
      { white: { name: 'Cleo', points: 0, gameWins: 0 }, black: null },
    ])
  })

  test('falls back to zero for a name the draw did not see', () => {
    expect(revealPairs([{ white: 'Dan', black: null, games: [] }], planned)).toEqual([
      { white: { name: 'Dan', points: 0, gameWins: 0 }, black: null },
    ])
  })
})
