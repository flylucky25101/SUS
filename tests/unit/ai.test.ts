import { describe, expect, it } from 'vitest';
import { AiController } from '../../src/ai/controller';
import { createWorld, stepWorld } from '../../src/core/combat';
import { EMPTY_COMMAND, type MatchOptions } from '../../src/core/types';

const OPTIONS: MatchOptions = {
  mode: 'quick',
  stageId: 'vector-spire',
  fighterOne: 'suri',
  fighterTwo: 'kade',
  difficulty: 'hard',
  seed: 17,
  hazards: false,
};

describe('AI input policy', () => {
  it('emits deterministic training attacks through the combat input pipeline', () => {
    const world = createWorld({ ...OPTIONS, mode: 'training' });
    world.training.behavior = 'attack';
    const controller = new AiController(77, 'normal');
    let inputPulses = 0;
    let attacks = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      const command = controller.next(world, 'p2');
      if (command.normal) inputPulses += 1;
      const { events } = stepWorld(world, { p1: { ...EMPTY_COMMAND }, p2: command });
      attacks += events.filter((event) => event.type === 'attack-start' && event.actorId === 'p2').length;
    }
    expect(inputPulses).toBe(13);
    expect(attacks).toBe(13);
  });

  it('aims long-range control projectiles toward the opponent while retreating', () => {
    const world = createWorld(OPTIONS);
    const self = world.fighters[0];
    const opponent = world.fighters[1];
    self.position = { x: 700, y: 520 };
    self.previousPosition = { ...self.position };
    self.grounded = true;
    self.standingPlatformId = 'main';
    opponent.position = { x: 300, y: 520 };
    opponent.previousPosition = { ...opponent.position };
    opponent.grounded = true;
    opponent.standingPlatformId = 'main';

    let projectileDecisions = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const command = new AiController(seed, 'hard').next(world, 'p1');
      if (!command.special) continue;
      projectileDecisions += 1;
      expect(command.moveX).toBeLessThan(0);
    }
    expect(projectileDecisions).toBeGreaterThan(10);
  });

  it('turns before a neutral projectile so the spawned shot faces the opponent', () => {
    const world = createWorld(OPTIONS);
    const self = world.fighters[0];
    const opponent = world.fighters[1];
    self.position = { x: 700, y: 520 };
    self.previousPosition = { ...self.position };
    self.facing = 1;
    self.grounded = true;
    self.standingPlatformId = 'main';
    opponent.position = { x: 500, y: 520 };
    opponent.previousPosition = { ...opponent.position };
    opponent.grounded = true;
    opponent.standingPlatformId = 'main';
    const controller = new AiController(1, 'hard');

    let checkedProjectile = false;
    for (let tick = 0; tick < 240 && !checkedProjectile; tick += 1) {
      const { events } = stepWorld(world, { p1: controller.next(world, 'p1'), p2: { ...EMPTY_COMMAND } });
      if (!events.some((event) => event.type === 'projectile' && event.actorId === 'p1')) continue;
      const projectile = world.projectiles.find((candidate) => candidate.ownerId === 'p1');
      if (projectile === undefined) continue;
      expect(Math.sign(projectile.velocity.x)).toBe(Math.sign(opponent.position.x - projectile.position.x));
      checkedProjectile = true;
    }
    expect(checkedProjectile).toBe(true);
  });
});
