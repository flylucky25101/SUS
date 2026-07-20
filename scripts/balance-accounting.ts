import type { FighterId, FighterInstanceId } from '../src/core/types';

export interface RecoveryTelemetry {
  attempted: number;
  succeeded: number;
}

export interface BalanceAccountingRecord {
  left: FighterId;
  right: FighterId;
  winner: FighterId | null;
  winnerSide: FighterInstanceId | null;
  damage: Record<FighterInstanceId, number>;
  recoveries: Record<FighterInstanceId, RecoveryTelemetry>;
}

export interface MatchupAccounting {
  firstWins: number;
  secondWins: number;
  draws: number;
  p1Wins: number;
  decisive: number;
}

export interface FighterAccounting {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  appearances: number;
  totalDamage: number;
  recoveries: RecoveryTelemetry;
}

export function countMatchupResults(
  matches: readonly BalanceAccountingRecord[],
  first: FighterId,
  second: FighterId,
): MatchupAccounting {
  const draws = matches.filter((record) => record.winnerSide === null).length;
  const p1Wins = matches.filter((record) => record.winnerSide === 'p1').length;
  const p2Wins = matches.filter((record) => record.winnerSide === 'p2').length;
  const mirror = first === second;
  return {
    firstWins: mirror ? p1Wins : matches.filter((record) => record.winner === first).length,
    secondWins: mirror ? p2Wins : matches.filter((record) => record.winner === second).length,
    draws,
    p1Wins,
    decisive: Math.max(1, matches.length - draws),
  };
}

export function collectFighterAccounting(
  matches: readonly BalanceAccountingRecord[],
  fighter: FighterId,
): FighterAccounting {
  let appearances = 0;
  let totalDamage = 0;
  let attempted = 0;
  let succeeded = 0;
  const nonMirror = matches.filter((record) => record.left !== record.right);

  for (const record of matches) {
    if (record.left === fighter) {
      appearances += 1;
      totalDamage += record.damage.p1;
      attempted += record.recoveries.p1.attempted;
      succeeded += record.recoveries.p1.succeeded;
    }
    if (record.right === fighter) {
      appearances += 1;
      totalDamage += record.damage.p2;
      attempted += record.recoveries.p2.attempted;
      succeeded += record.recoveries.p2.succeeded;
    }
  }

  const wins = nonMirror.filter((record) => record.winner === fighter).length;
  const losses = nonMirror.filter((record) => record.winner !== null && record.winner !== fighter).length;
  const draws = nonMirror.filter((record) => record.winner === null).length;
  return {
    games: nonMirror.length,
    wins,
    losses,
    draws,
    appearances,
    totalDamage,
    recoveries: { attempted, succeeded },
  };
}
