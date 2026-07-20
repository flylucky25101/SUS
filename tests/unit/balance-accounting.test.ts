import { describe, expect, it } from 'vitest';
import {
  collectFighterAccounting,
  countMatchupResults,
  type BalanceAccountingRecord,
} from '../../scripts/balance-accounting';

describe('balance accounting', () => {
  it('counts both sides of mirror matches', () => {
    const matches: BalanceAccountingRecord[] = [
      {
        left: 'kade',
        right: 'kade',
        winner: 'kade',
        winnerSide: 'p1',
        damage: { p1: 100, p2: 60 },
        recoveries: {
          p1: { attempted: 2, succeeded: 1 },
          p2: { attempted: 3, succeeded: 3 },
        },
      },
      {
        left: 'kade',
        right: 'kade',
        winner: 'kade',
        winnerSide: 'p2',
        damage: { p1: 40, p2: 80 },
        recoveries: {
          p1: { attempted: 1, succeeded: 0 },
          p2: { attempted: 2, succeeded: 1 },
        },
      },
    ];

    expect(countMatchupResults(matches, 'kade', 'kade')).toEqual({
      firstWins: 1,
      secondWins: 1,
      draws: 0,
      p1Wins: 1,
      decisive: 2,
    });
    expect(collectFighterAccounting(matches, 'kade')).toEqual({
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      appearances: 4,
      totalDamage: 280,
      recoveries: { attempted: 8, succeeded: 5 },
    });
  });

  it('preserves fighter and side accounting when non-mirror seats are swapped', () => {
    const matches: BalanceAccountingRecord[] = [
      {
        left: 'kade',
        right: 'mira',
        winner: 'kade',
        winnerSide: 'p1',
        damage: { p1: 100, p2: 50 },
        recoveries: {
          p1: { attempted: 2, succeeded: 1 },
          p2: { attempted: 4, succeeded: 2 },
        },
      },
      {
        left: 'mira',
        right: 'kade',
        winner: 'kade',
        winnerSide: 'p2',
        damage: { p1: 70, p2: 90 },
        recoveries: {
          p1: { attempted: 1, succeeded: 1 },
          p2: { attempted: 3, succeeded: 3 },
        },
      },
      {
        left: 'kade',
        right: 'mira',
        winner: null,
        winnerSide: null,
        damage: { p1: 80, p2: 60 },
        recoveries: {
          p1: { attempted: 1, succeeded: 0 },
          p2: { attempted: 2, succeeded: 1 },
        },
      },
    ];

    expect(countMatchupResults(matches, 'kade', 'mira')).toEqual({
      firstWins: 2,
      secondWins: 0,
      draws: 1,
      p1Wins: 1,
      decisive: 2,
    });
    expect(collectFighterAccounting(matches, 'kade')).toEqual({
      games: 3,
      wins: 2,
      losses: 0,
      draws: 1,
      appearances: 3,
      totalDamage: 270,
      recoveries: { attempted: 6, succeeded: 4 },
    });
    expect(collectFighterAccounting(matches, 'mira')).toEqual({
      games: 3,
      wins: 0,
      losses: 2,
      draws: 1,
      appearances: 3,
      totalDamage: 180,
      recoveries: { attempted: 7, succeeded: 4 },
    });
  });
});
