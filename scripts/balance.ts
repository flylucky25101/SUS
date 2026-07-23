import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAiControllers } from '../src/ai/controller';
import { createWorld, stepWorld } from '../src/core/combat';
import { GAME_CONFIG } from '../src/core/config';
import type { CombatEvent, FighterId, FighterInstanceId, MatchResult } from '../src/core/types';
import { FIGHTERS } from '../src/data/fighters';
import { collectFighterAccounting, countMatchupResults, type BalanceAccountingRecord } from './balance-accounting';

interface CliOptions {
  games: number;
  reportPath: string;
  markdownPath: string | null;
}

interface MatchRecord extends BalanceAccountingRecord {
  pairing: string;
  left: FighterId;
  right: FighterId;
  winner: FighterId | null;
  winnerSide: FighterInstanceId | null;
  reason: MatchResult['reason'];
  ticks: number;
  ringouts: number;
  moveUses: Record<string, number>;
  moveHits: Record<string, number>;
  seed: number;
}

interface MatchupSummary {
  pairing: string;
  first: FighterId;
  second: FighterId;
  games: number;
  firstWins: number;
  secondWins: number;
  draws: number;
  firstWinRate: number;
  p1WinRate: number;
}

interface CharacterSummary {
  fighter: FighterId;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  averageDamage: number;
  recoveryRate: number;
}

interface BalanceReport {
  generatedAt: string;
  seeds: { first: number; last: number; formula: string };
  games: number;
  averageTicks: number;
  averageSeconds: number;
  averageRingouts: number;
  timeoutRate: number;
  drawRate: number;
  p1WinRate: number;
  matchups: MatchupSummary[];
  characters: CharacterSummary[];
  moveUsage: Array<{ moveId: string; uses: number; hits: number; accuracy: number; share: number }>;
  outliers: string[];
  warnings: string[];
  passed: boolean;
  limitations: string[];
}

const MATCHUP_RATE_MINIMUM = 0.38;
const MATCHUP_RATE_MAXIMUM = 0.62;
const OVERALL_RATE_MINIMUM = 0.44;
const OVERALL_RATE_MAXIMUM = 0.56;

const FIGHTER_IDS = FIGHTERS.map((fighter) => fighter.id);
const PAIRINGS: Array<readonly [FighterId, FighterId]> = [];
for (let first = 0; first < FIGHTER_IDS.length; first += 1) {
  for (let second = first; second < FIGHTER_IDS.length; second += 1) {
    const firstId = FIGHTER_IDS[first];
    const secondId = FIGHTER_IDS[second];
    if (firstId !== undefined && secondId !== undefined) PAIRINGS.push([firstId, secondId]);
  }
}

function parseOptions(argumentsList: readonly string[]): CliOptions {
  let games = 320;
  let reportPath = 'artifacts/balance-fast.json';
  let markdownPath: string | null = null;
  for (const argument of argumentsList) {
    if (argument.startsWith('--games=')) games = Math.max(20, Math.trunc(Number(argument.slice('--games='.length))));
    else if (argument.startsWith('--report=')) reportPath = argument.slice('--report='.length);
    else if (argument.startsWith('--markdown=')) markdownPath = argument.slice('--markdown='.length);
  }
  if (!Number.isFinite(games)) throw new Error('Balance game count must be finite.');
  return { games, reportPath, markdownPath };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function collectEvent(event: CombatEvent, uses: Record<string, number>, hits: Record<string, number>): number {
  if (event.type === 'attack-start' && event.moveId !== null) increment(uses, event.moveId);
  if ((event.type === 'hit' || event.type === 'strong-hit') && event.moveId !== null) increment(hits, event.moveId);
  return event.type === 'ringout' ? 1 : 0;
}

function simulateMatch(left: FighterId, right: FighterId, seed: number): MatchRecord {
  const world = createWorld({
    mode: 'debug',
    stageId: 'vector-spire',
    fighterOne: left,
    fighterTwo: right,
    difficulty: 'hard',
    seed,
    hazards: false,
  });
  const controllers = createAiControllers(seed, 'hard');
  const moveUses: Record<string, number> = {};
  const moveHits: Record<string, number> = {};
  let ringouts = 0;
  const maximumTicks = GAME_CONFIG.matchFrames + GAME_CONFIG.suddenDeathFrames + 300;
  while (!world.ended && world.tick < maximumTicks) {
    const result = stepWorld(world, {
      p1: controllers.p1.next(world, 'p1'),
      p2: controllers.p2.next(world, 'p2'),
    });
    for (const event of result.events) ringouts += collectEvent(event, moveUses, moveHits);
  }
  if (world.result === null) throw new Error(`Simulation ${seed} exceeded its safety limit without a result.`);
  const winner = world.result.winnerId === 'p1' ? left : world.result.winnerId === 'p2' ? right : null;
  const first = world.fighters[0];
  const second = world.fighters[1];
  return {
    pairing: canonicalPair(left, right),
    left,
    right,
    winner,
    winnerSide: world.result.winnerId,
    reason: world.result.reason,
    ticks: world.result.completedAtTick,
    ringouts,
    damage: { p1: first.totalDamageDealt, p2: second.totalDamageDealt },
    recoveries: {
      p1: { attempted: first.recoveriesAttempted, succeeded: first.recoveriesSucceeded },
      p2: { attempted: second.recoveriesAttempted, succeeded: second.recoveriesSucceeded },
    },
    moveUses,
    moveHits,
    seed,
  };
}

function canonicalPair(first: FighterId, second: FighterId): string {
  const firstIndex = FIGHTER_IDS.indexOf(first);
  const secondIndex = FIGHTER_IDS.indexOf(second);
  return firstIndex <= secondIndex ? `${first}|${second}` : `${second}|${first}`;
}

function summarize(records: readonly MatchRecord[]): BalanceReport {
  const matchupSummaries: MatchupSummary[] = PAIRINGS.map(([first, second]) => {
    const pairing = canonicalPair(first, second);
    const matches = records.filter((record) => record.pairing === pairing);
    const accounting = countMatchupResults(matches, first, second);
    return {
      pairing,
      first,
      second,
      games: matches.length,
      firstWins: accounting.firstWins,
      secondWins: accounting.secondWins,
      draws: accounting.draws,
      firstWinRate: accounting.firstWins / accounting.decisive,
      p1WinRate: accounting.p1Wins / accounting.decisive,
    };
  });

  const characterSummaries: CharacterSummary[] = FIGHTER_IDS.map((fighter) => {
    const matches = records.filter((record) => record.left === fighter || record.right === fighter);
    const accounting = collectFighterAccounting(matches, fighter);
    return {
      fighter,
      games: accounting.games,
      wins: accounting.wins,
      losses: accounting.losses,
      draws: accounting.draws,
      winRate: accounting.wins / Math.max(1, accounting.wins + accounting.losses),
      averageDamage: accounting.totalDamage / Math.max(1, accounting.appearances),
      recoveryRate: accounting.recoveries.succeeded / Math.max(1, accounting.recoveries.attempted),
    };
  });

  const totalUses: Record<string, number> = {};
  const totalHits: Record<string, number> = {};
  for (const record of records) {
    for (const [moveId, count] of Object.entries(record.moveUses)) totalUses[moveId] = (totalUses[moveId] ?? 0) + count;
    for (const [moveId, count] of Object.entries(record.moveHits)) totalHits[moveId] = (totalHits[moveId] ?? 0) + count;
  }
  const allUses = Math.max(1, Object.values(totalUses).reduce((sum, value) => sum + value, 0));
  const moveUsage = Object.entries(totalUses).map(([moveId, uses]) => ({
    moveId,
    uses,
    hits: totalHits[moveId] ?? 0,
    accuracy: (totalHits[moveId] ?? 0) / Math.max(1, uses),
    share: uses / allUses,
  })).sort((first, second) => second.uses - first.uses);

  const outliers: string[] = [];
  const warnings: string[] = [];
  for (const matchup of matchupSummaries) {
    if (matchup.games < 12) continue;
    if (matchup.first === matchup.second) {
      if (matchup.p1WinRate < MATCHUP_RATE_MINIMUM || matchup.p1WinRate > MATCHUP_RATE_MAXIMUM) outliers.push(`${matchup.pairing} starting-side rate ${(matchup.p1WinRate * 100).toFixed(1)}%`);
    } else if (matchup.firstWinRate < MATCHUP_RATE_MINIMUM || matchup.firstWinRate > MATCHUP_RATE_MAXIMUM) {
      outliers.push(`${matchup.pairing} rate ${(matchup.firstWinRate * 100).toFixed(1)}% for ${matchup.first}`);
    }
  }
  for (const character of characterSummaries) {
    if (character.winRate < OVERALL_RATE_MINIMUM || character.winRate > OVERALL_RATE_MAXIMUM) outliers.push(`${character.fighter} overall ${(character.winRate * 100).toFixed(1)}%`);
    if (character.recoveryRate < 0.35) warnings.push(`${character.fighter} recovery success ${(character.recoveryRate * 100).toFixed(1)}%`);
  }
  const expectedEdges: ReadonlyArray<readonly [FighterId, FighterId]> = [
    ['mira', 'suri'],
    ['bram', 'mira'],
    ['suri', 'bram'],
    ['juno', 'bram'],
    ['suri', 'juno'],
    ['orin', 'suri'],
  ];
  for (const [favored, opponent] of expectedEdges) {
    const matchup = matchupSummaries.find((entry) => entry.pairing === canonicalPair(favored, opponent));
    if (matchup === undefined) continue;
    const favoredRate = matchup.first === favored ? matchup.firstWinRate : 1 - matchup.firstWinRate;
    if (favoredRate < 0.5 || favoredRate > MATCHUP_RATE_MAXIMUM) warnings.push(`target edge ${favored}>${opponent} measured ${(favoredRate * 100).toFixed(1)}%`);
  }
  const dominantMove = moveUsage[0];
  if (dominantMove !== undefined && dominantMove.share > 0.28) outliers.push(`${dominantMove.moveId} uses ${(dominantMove.share * 100).toFixed(1)}% of all attacks`);
  const timeoutRate = records.filter((record) => record.reason === 'time' || record.reason === 'draw').length / Math.max(1, records.length);
  if (timeoutRate > 0.18) outliers.push(`timeout rate ${(timeoutRate * 100).toFixed(1)}%`);
  const p1WinRate = records.filter((record) => record.winnerSide === 'p1').length / Math.max(1, records.filter((record) => record.winnerSide !== null).length);
  if (p1WinRate < 0.46 || p1WinRate > 0.54) warnings.push(`aggregate starting-side rate ${(p1WinRate * 100).toFixed(1)}%`);

  const totalTicks = records.reduce((sum, record) => sum + record.ticks, 0);
  const totalRingouts = records.reduce((sum, record) => sum + record.ringouts, 0);
  return {
    generatedAt: new Date().toISOString(),
    seeds: { first: records[0]?.seed ?? 0, last: records.at(-1)?.seed ?? 0, formula: 'seed = 101 + gameIndex × 7919' },
    games: records.length,
    averageTicks: totalTicks / Math.max(1, records.length),
    averageSeconds: totalTicks / Math.max(1, records.length) / GAME_CONFIG.simulationHz,
    averageRingouts: totalRingouts / Math.max(1, records.length),
    timeoutRate,
    drawRate: records.filter((record) => record.winner === null).length / Math.max(1, records.length),
    p1WinRate,
    matchups: matchupSummaries,
    characters: characterSummaries,
    moveUsage,
    outliers,
    warnings,
    passed: outliers.length === 0,
    limitations: [
      'AI-versus-AI results include policy and reaction-model bias and are not proof of human matchup balance.',
      'The simulator uses the competitive stage with hazards disabled and fixed hard-difficulty policy parameters.',
      'Human mix-ups, touch execution variance, and device frame pacing require separate playtesting.',
    ],
  };
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function markdown(report: BalanceReport): string {
  const matchupRows = report.matchups.map((entry) => `| ${entry.first} vs ${entry.second} | ${entry.games} | ${percentage(entry.firstWinRate)} | ${percentage(entry.p1WinRate)} | ${entry.draws} |`).join('\n');
  const characterRows = report.characters.map((entry) => `| ${entry.fighter} | ${entry.games} | ${percentage(entry.winRate)} | ${entry.averageDamage.toFixed(1)} | ${percentage(entry.recoveryRate)} |`).join('\n');
  const moveRows = report.moveUsage.slice(0, 12).map((entry) => `| ${entry.moveId} | ${entry.uses} | ${percentage(entry.accuracy)} | ${percentage(entry.share)} |`).join('\n');
  return `# Rift Forge Balance Report

Generated from the headless 60 Hz combat core. This report is empirical AI-policy telemetry, not a claim of solved human balance.

## Run summary

- Seeds: ${report.seeds.first} through ${report.seeds.last} (${report.seeds.formula})
- Matches: ${report.games}
- Average bout: ${report.averageSeconds.toFixed(1)} seconds (${report.averageTicks.toFixed(0)} ticks)
- Average ringouts: ${report.averageRingouts.toFixed(2)}
- Timeout rate: ${percentage(report.timeoutRate)}
- Draw rate: ${percentage(report.drawRate)}
- Starting-side win rate: ${percentage(report.p1WinRate)}
- Automated anomaly gate: ${report.passed ? 'PASS' : 'REVIEW'}

## Matchups

| Matchup | Games | First fighter win | P1-side win | Draws |
| --- | ---: | ---: | ---: | ---: |
${matchupRows}

## Character totals

Mirror matches are excluded from overall win rates.

| Fighter | Games | Win rate | Avg damage dealt | Recovery success |
| --- | ---: | ---: | ---: | ---: |
${characterRows}

## Highest-use moves

| Move | Uses | Accuracy | Global share |
| --- | ---: | ---: | ---: |
${moveRows}

## Detected anomalies

${report.outliers.length === 0 ? '- None crossed the hard anomaly thresholds.' : report.outliers.map((value) => `- ${value}`).join('\n')}

## Directional warnings

${report.warnings.length === 0 ? '- None.' : report.warnings.map((value) => `- ${value}`).join('\n')}

## Adjustments and comparison

- Combat values remain centralized in character move data and the shared physics configuration.
- Suri's Prism Orbit uses a 70-frame cooldown so its long-range identity remains intact without continuous projectile cycling.
- The six-fighter anomaly gate allows designed archetype edges up to 62/38 while keeping overall fighter rates inside 56/44; the wider overall band absorbs deterministic small-sample variance while the 5,040-match report remains the tuning baseline.
- This generated run is the current baseline; future tuning should change one or two related values, rerun unit tests, and compare this table.
- No result weighting, forced winner, matchup modifier, or side-specific stat adjustment is used.

## Remaining risks

${report.limitations.map((value) => `- ${value}`).join('\n')}
`;
}

function writeOutput(path: string, contents: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
}

const options = parseOptions(process.argv.slice(2));
const records: MatchRecord[] = [];
for (let game = 0; game < options.games; game += 1) {
  const pairing = PAIRINGS[game % PAIRINGS.length];
  if (pairing === undefined) throw new Error('No balance pairings are configured.');
  const block = Math.floor(game / PAIRINGS.length);
  const swap = block % 2 === 1;
  const left = swap ? pairing[1] : pairing[0];
  const right = swap ? pairing[0] : pairing[1];
  records.push(simulateMatch(left, right, 101 + game * 7919));
}
const report = summarize(records);
writeOutput(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (options.markdownPath !== null) writeOutput(options.markdownPath, markdown(report));
process.stdout.write(`Balance simulation: ${report.games} matches, ${report.averageSeconds.toFixed(1)}s average, ${percentage(report.timeoutRate)} timeouts, ${report.outliers.length} hard outliers.\n`);
if (!report.passed) {
  process.stdout.write(`${report.outliers.map((outlier) => `- ${outlier}`).join('\n')}\n`);
  process.exitCode = 1;
}
