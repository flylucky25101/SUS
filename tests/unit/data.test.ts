import { describe, expect, it } from 'vitest';
import { validateFighters, validateStages } from '../../src/core/validation';
import { FIGHTERS, getFighter } from '../../src/data/fighters';
import { STAGES } from '../../src/data/stages';

describe('runtime data schemas', () => {
  it('validates every fighter and move definition', () => {
    expect(() => validateFighters(FIGHTERS)).not.toThrow();
    expect(FIGHTERS).toHaveLength(6);
    for (const fighter of FIGHTERS) expect(Object.values(fighter.moves).length).toBeGreaterThanOrEqual(9);
  });

  it('keeps JUNO and ORIN mechanically distinct', () => {
    const juno = getFighter('juno');
    const orin = getFighter('orin');
    expect(juno.moves.neutralSpecial?.projectile?.speed).toBeGreaterThan(orin.moves.neutralSpecial?.projectile?.speed ?? 0);
    expect(juno.moves.downSpecial?.reflectProjectiles).toBe(true);
    expect(orin.moves.sideSpecial?.armorFrames).toBeGreaterThan(0);
    expect(orin.stats.weight).toBeGreaterThan(juno.stats.weight);
    expect(Object.values(juno.budget).reduce((sum, value) => sum + value, 0)).toBe(36);
    expect(Object.values(orin.budget).reduce((sum, value) => sum + value, 0)).toBe(36);
  });

  it('validates both stage definitions', () => {
    expect(() => validateStages(STAGES)).not.toThrow();
    expect(STAGES).toHaveLength(2);
  });
});
