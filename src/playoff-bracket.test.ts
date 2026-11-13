import { describe, expect, test } from 'bun:test'
import { matchPlayers, qualification, recordWinner } from './playoff-bracket'
import type { PlayoffBracket } from './playoff-bracket'
import type { IStanding } from './match-score'

function player(name: string, wins: number, played = 4): IStanding {
  return { name, wins, played, points: wins, draws: 0, losses: played - wins, gameWins: wins * 2 }
}
const field = [player('Leader', 4), ...['A', 'B', 'C', 'D'].map(name => player(name, 3))]
const bracket: PlayoffBracket = { finalist: 'Leader', seeds: ['A', 'B', 'C', 'D'], winners: {} }

describe('playoff qualification', () => {
  test('places the four-win finalist before the playoff field is ready', () => {
    expect(qualification([field[0]!])).toMatchObject({ finalist: 'Leader', canDraw: false })
  })
  test('opens the draw for exactly four three-win players and one finalist', () => {
    expect(qualification(field)).toMatchObject({ canDraw: true, contenders: ['A', 'B', 'C', 'D'] })
  })
  test('does not treat individual game wins or points as match wins', () => {
    expect(qualification([player('A', 2), player('B', 1)])).toMatchObject({ finalist: null, contenders: [], canDraw: false })
  })
  test('blocks incomplete, excessive, or ambiguous fields', () => {
    expect(qualification(field.slice(0, 4)).canDraw).toBe(false)
    expect(qualification([...field, player('E', 3)]).canDraw).toBe(false)
    expect(qualification([...field, player('Other leader', 4)]).canDraw).toBe(false)
    expect(qualification(field.map(p => p.name === 'D' ? { ...p, played: 3 } : p)).canDraw).toBe(false)
  })
})

describe('playoff advancement', () => {
  test('winners pass through both finals without changing the direct finalist', () => {
    let current = recordWinner(bracket, 'semi1', 'B')
    current = recordWinner(current, 'semi2', 'C')
    expect(matchPlayers(current, 'qualifier')).toEqual(['B', 'C'])
    current = recordWinner(current, 'qualifier', 'C')
    expect(matchPlayers(current, 'grand')).toEqual(['Leader', 'C'])
    current = recordWinner(current, 'grand', 'Leader')
    expect(current.winners.grand).toBe('Leader')
    expect(bracket.winners).toEqual({})
  })
  test('rejects outsiders and matches with missing players', () => {
    expect(() => recordWinner(bracket, 'semi1', 'C')).toThrow()
    expect(() => recordWinner(bracket, 'qualifier', 'A')).toThrow()
    expect(() => recordWinner(bracket, 'grand', 'Leader')).toThrow()
  })
  test('changing or clearing a semifinal clears dependent results only', () => {
    const finished: PlayoffBracket = { ...bracket, winners: { semi1: 'A', semi2: 'C', qualifier: 'A', grand: 'Leader' } }
    expect(recordWinner(finished, 'semi1', 'B').winners).toEqual({ semi1: 'B', semi2: 'C' })
    expect(recordWinner(finished, 'semi1', null).winners).toEqual({ semi2: 'C' })
    expect(recordWinner(finished, 'qualifier', 'C').winners).toEqual({ semi1: 'A', semi2: 'C', qualifier: 'C' })
    expect(recordWinner(finished, 'semi1', 'A')).toEqual(finished)
  })
})
