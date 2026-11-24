import { describe, expect, test } from 'bun:test'
import { addGame, advanceFromGames, matchPlayers, placeQualified, qualification, recordWinner } from './playoff-bracket'
import type { PlayoffBracket } from './playoff-bracket'
import type { IStanding } from './match-score'

function player(name: string, wins: number, played = 4): IStanding {
  return { name, wins, played, points: wins, draws: 0, losses: played - wins, gameWins: wins * 2 }
}
const field = [player('Leader', 4), ...['A', 'B', 'C', 'D'].map(name => player(name, 3))]
const bracket: PlayoffBracket = { finalist: 'Leader', seeds: ['A', 'B', 'C', 'D'], winners: {} }

describe('playoff qualification', () => {
  test('counts four players who finished on three wins and the four-win finalist', () => {
    expect(qualification(field)).toMatchObject({ finalist: 'Leader', contenders: ['A', 'B', 'C', 'D'], reason: null })
  })
  test('qualifies a three-win player only after their last qualifying match', () => {
    const unfinished = field.map(p => p.name === 'D' ? { ...p, played: 3 } : p)
    expect(qualification(unfinished).contenders).toEqual(['A', 'B', 'C'])
  })
  test('waits on the finalist while another player can still reach four wins', () => {
    expect(qualification([field[0]!, player('Chaser', 3, 3)]).finalist).toBeNull()
  })
  test('does not treat individual game wins or points as match wins', () => {
    expect(qualification([player('A', 2), player('B', 1)])).toMatchObject({ finalist: null, contenders: [] })
  })
  test('asks the organizer to resolve excessive or ambiguous fields', () => {
    expect(qualification([...field, player('E', 3)]).reason).not.toBeNull()
    expect(qualification([...field, player('Other leader', 4)]).reason).not.toBeNull()
  })
})

describe('semifinal seats', () => {
  test('creates nothing until someone qualifies', () => {
    expect(placeQualified(null, null, [])).toBeNull()
  })
  test('fills seats in the order players qualify, two per semifinal', () => {
    let current = placeQualified(null, null, ['A'])!
    expect(current.seeds).toEqual(['A', null, null, null])
    current = placeQualified(current, null, ['A', 'B', 'C'])!
    expect(matchPlayers(current, 'semi1')).toEqual(['A', 'B'])
    expect(matchPlayers(current, 'semi2')).toEqual(['C', null])
  })
  test('lets a full semifinal take games before the other is set', () => {
    const current = placeQualified(null, null, ['A', 'B'])!
    expect(addGame(current, 'semi1', 'https://www.chess.com/game/live/9').games).toEqual({ semi1: ['https://www.chess.com/game/live/9'] })
    expect(() => addGame(current, 'semi2', 'https://www.chess.com/game/live/9')).toThrow()
  })
  test('never moves a seated player and keeps the bracket when nothing changes', () => {
    const current = placeQualified(null, 'Leader', ['B', 'A'])!
    const next = placeQualified(current, 'Leader', ['A', 'B'])
    expect(next).toBe(current)
    expect(next!.seeds).toEqual(['B', 'A', null, null])
  })
  test('keeps a full bracket as it is', () => {
    expect(placeQualified(bracket, 'Leader', ['A', 'B', 'C', 'D', 'E'])).toBe(bracket)
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

describe('advancing from game results', () => {
  test('a semifinal decided on games sends its winner straight to the playoff final', () => {
    let current = advanceFromGames(bracket, 'semi1', 'B')
    current = advanceFromGames(current, 'semi2', 'C')
    expect(current.winners).toEqual({ semi1: 'B', semi2: 'C' })
    expect(matchPlayers(current, 'qualifier')).toEqual(['B', 'C'])
  })
  test('leaves an undecided match open', () => {
    expect(advanceFromGames(bracket, 'semi1', null)).toBe(bracket)
  })
  test('keeps a result the organizer already recorded', () => {
    const recorded = recordWinner(bracket, 'semi1', 'A')
    expect(advanceFromGames(recorded, 'semi1', 'B')).toBe(recorded)
  })
})

describe('playoff game links', () => {
  const link = 'https://www.chess.com/game/live/1'
  test('adds links only to matches with both players', () => {
    expect(addGame(bracket, 'semi1', link).games).toEqual({ semi1: [link] })
    expect(() => addGame(bracket, 'qualifier', link)).toThrow()
  })
  test('rejects a link already used anywhere in the playoff', () => {
    expect(() => addGame(addGame(bracket, 'semi1', link), 'semi2', link)).toThrow()
  })
  test('a correction drops links only from matches whose players changed', () => {
    const played: PlayoffBracket = {
      ...bracket,
      winners: { semi1: 'A', semi2: 'C', qualifier: 'A' },
      games: { semi1: ['s1'], semi2: ['s2'], qualifier: ['q'], grand: ['g'] },
    }
    expect(recordWinner(played, 'semi1', 'B').games).toEqual({ semi1: ['s1'], semi2: ['s2'] })
    expect(recordWinner(played, 'qualifier', 'C').games).toEqual({ semi1: ['s1'], semi2: ['s2'], qualifier: ['q'] })
    expect(recordWinner(played, 'grand', 'A').games).toEqual(played.games)
  })
})
