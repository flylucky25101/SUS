import { describe, expect, it } from 'vitest';
import { createWorld, emptyCommands, stepWorld } from '../../src/core/combat';
import { calculateKnockback } from '../../src/core/math';
import { EMPTY_COMMAND, type MatchOptions } from '../../src/core/types';
import { getFighter } from '../../src/data/fighters';

const BASE: MatchOptions = { mode: 'quick', stageId: 'vector-spire', fighterOne: 'mira', fighterTwo: 'bram', difficulty: 'hard', seed: 99, hazards: false };

describe('combat scenarios', () => {
  it('activates Mira fast jab before Bram heavy side attack', () => {
    const mira = getFighter('mira').moves.jab;
    const bram = getFighter('bram').moves.sideNormal;
    expect(mira?.startupFrames).toBeLessThan(bram?.startupFrames ?? 0);
  });

  it('launches lightweight Mira farther than heavyweight Bram', () => {
    const shared = { accumulatedDamage: 100, attackDamage: 12, baseKnockback: 5, knockbackGrowth: 1.1, chargeRatio: 0, comboHits: 1 };
    const mira = calculateKnockback({ ...shared, defenderWeight: getFighter('mira').stats.weight });
    const bram = calculateKnockback({ ...shared, defenderWeight: getFighter('bram').stats.weight });
    expect(mira).toBeGreaterThan(bram);
  });

  it('limits Suri projectiles according to move data', () => {
    const world = createWorld({ ...BASE, fighterOne: 'suri' });
    const fighter = world.fighters[0];
    fighter.grounded = true;
    fighter.standingPlatformId = 'main';
    fighter.position.y = 520;
    const move = getFighter('suri').moves.neutralSpecial;
    if (move?.projectile === null || move === undefined) throw new Error('Expected projectile data.');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      fighter.status = 'attack';
      fighter.attack = { moveId: move.id, frame: move.startupFrames - 1, chargeRatio: 0, hitTargets: [], projectileSpawned: false };
      stepWorld(world, emptyCommands());
      fighter.attack = null;
      fighter.status = 'idle';
    }
    expect(world.projectiles.filter((projectile) => projectile.ownerId === 'p1').length).toBeLessThanOrEqual(move.projectile.maxActive);
  });

  it('restores recovery use only after a landing', () => {
    const world = createWorld(BASE);
    const fighter = world.fighters[0];
    fighter.position = { x: 500, y: 450 };
    fighter.previousPosition = { ...fighter.position };
    fighter.grounded = false;
    fighter.recoveryUsed = true;
    fighter.velocity.y = 8;
    for (let frame = 0; frame < 20 && !fighter.grounded; frame += 1) stepWorld(world, emptyCommands());
    expect(fighter.grounded).toBe(true);
    expect(fighter.recoveryUsed).toBe(false);
  });

  it('adds combo escape scaling after repeated hits', () => {
    const base = { accumulatedDamage: 60, attackDamage: 4, baseKnockback: 2, knockbackGrowth: 0.6, defenderWeight: 100, chargeRatio: 0 };
    expect(calculateKnockback({ ...base, comboHits: 8 })).toBeGreaterThan(calculateKnockback({ ...base, comboHits: 1 }));
  });

  it('keeps player movement finite after extreme repeated steps', () => {
    const world = createWorld(BASE);
    for (let frame = 0; frame < 600; frame += 1) {
      stepWorld(world, { p1: { ...EMPTY_COMMAND, moveX: 1, moveY: frame % 5 === 0 ? 1 : 0 }, p2: { ...EMPTY_COMMAND, moveX: -1 } });
      if (world.ended) break;
    }
    for (const fighter of world.fighters) {
      expect(Number.isFinite(fighter.position.x)).toBe(true);
      expect(Number.isFinite(fighter.position.y)).toBe(true);
      expect(Number.isFinite(fighter.velocity.x)).toBe(true);
      expect(Number.isFinite(fighter.velocity.y)).toBe(true);
    }
  });
});
