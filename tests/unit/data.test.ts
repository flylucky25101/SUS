import { describe, expect, it } from 'vitest';
import { validateFighters, validateStages } from '../../src/core/validation';
import { FIGHTERS } from '../../src/data/fighters';
import { STAGES } from '../../src/data/stages';

describe('runtime data schemas', () => {
  it('validates every fighter and move definition', () => {
    expect(() => validateFighters(FIGHTERS)).not.toThrow();
    expect(FIGHTERS).toHaveLength(4);
    for (const fighter of FIGHTERS) expect(Object.values(fighter.moves).length).toBeGreaterThanOrEqual(9);
  });

  it('validates both stage definitions', () => {
    expect(() => validateStages(STAGES)).not.toThrow();
    expect(STAGES).toHaveLength(2);
  });
});
