import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/core/config';
import { angleToVector, calculateHitstun, calculateKnockback, clamp, SeededRandom } from '../../src/core/math';

describe('combat math', () => {
  it('clamps impact values and rejects non-finite input', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
    expect(clamp(Number.POSITIVE_INFINITY, -1, 1)).toBe(-1);
  });

  it('increases knockback as accumulated impact rises', () => {
    const base = { attackDamage: 8, baseKnockback: 4, knockbackGrowth: 1, defenderWeight: 100, chargeRatio: 0, comboHits: 1 };
    const low = calculateKnockback({ ...base, accumulatedDamage: 10 });
    const high = calculateKnockback({ ...base, accumulatedDamage: 150 });
    expect(high).toBeGreaterThan(low);
  });

  it('applies defender weight to launch force', () => {
    const base = { accumulatedDamage: 90, attackDamage: 10, baseKnockback: 5, knockbackGrowth: 1.1, chargeRatio: 0, comboHits: 1 };
    expect(calculateKnockback({ ...base, defenderWeight: 80 })).toBeGreaterThan(calculateKnockback({ ...base, defenderWeight: 140 }));
  });

  it('applies limited charge scaling', () => {
    const base = { accumulatedDamage: 60, attackDamage: 10, baseKnockback: 4, knockbackGrowth: 1, defenderWeight: 100, comboHits: 1 };
    expect(calculateKnockback({ ...base, chargeRatio: 1 })).toBeGreaterThan(calculateKnockback({ ...base, chargeRatio: 0 }));
  });

  it('caps extreme knockback and hitstun', () => {
    const value = calculateKnockback({ accumulatedDamage: 999999, attackDamage: 999, baseKnockback: 999, knockbackGrowth: 999, defenderWeight: 1, chargeRatio: 99, comboHits: 99 });
    expect(value).toBe(GAME_CONFIG.maxKnockback);
    expect(calculateHitstun(999, value, 0)).toBe(GAME_CONFIG.maxHitstunFrames);
  });

  it('converts attack angles using screen-space upward Y', () => {
    expect(angleToVector(0, 1)).toEqual({ x: 1, y: -0 });
    const up = angleToVector(90, 1);
    expect(Math.abs(up.x)).toBeLessThan(0.0001);
    expect(up.y).toBeCloseTo(-1);
    expect(angleToVector(0, -1).x).toBe(-1);
  });

  it('produces deterministic seeded random sequences', () => {
    const first = new SeededRandom(731);
    const second = new SeededRandom(731);
    expect(Array.from({ length: 8 }, () => first.next())).toEqual(Array.from({ length: 8 }, () => second.next()));
  });

  it('uses a non-zero fallback for a zero seed', () => {
    const random = new SeededRandom(0);
    expect(random.next()).toBeGreaterThan(0);
  });
});
