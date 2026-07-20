import { describe, expect, it } from 'vitest';
import { attackHitbox, createWorld, emptyCommands, forceMatchEnd, resetTrainingDamage, resetTrainingPositions, setPaused, stepWorld } from '../../src/core/combat';
import { GAME_CONFIG } from '../../src/core/config';
import { EMPTY_COMMAND, type FighterState, type MatchOptions, type ProjectileState, type WorldState } from '../../src/core/types';
import { getFighter } from '../../src/data/fighters';
import { getStage } from '../../src/data/stages';

const OPTIONS: MatchOptions = {
  mode: 'quick',
  stageId: 'vector-spire',
  fighterOne: 'kade',
  fighterTwo: 'bram',
  difficulty: 'normal',
  seed: 42,
  hazards: true,
};

function groundedWorld(): WorldState {
  const world = createWorld(OPTIONS);
  for (const fighter of world.fighters) {
    fighter.grounded = true;
    fighter.standingPlatformId = 'main';
    fighter.position.y = 520;
    fighter.previousPosition.y = 520;
  }
  return world;
}

function armAttack(fighter: FighterState, key: string): void {
  const move = getFighter(fighter.definitionId).moves[key];
  if (move === undefined) throw new Error(`Missing test move ${key}.`);
  fighter.status = 'attack';
  fighter.attack = { moveId: move.id, frame: move.startupFrames - 1, chargeRatio: 0, hitTargets: [], projectileSpawned: false };
}

function projectileAt(target: FighterState, ownerId: ProjectileState['ownerId']): ProjectileState {
  return {
    id: 1,
    ownerId,
    moveId: 'test.projectile',
    position: { x: target.position.x, y: target.position.y - 40 },
    velocity: { x: ownerId === 'p1' ? 1 : -1, y: 0 },
    radius: 12,
    lifetimeFrames: 60,
    damage: 6,
    baseKnockback: 3,
    knockbackGrowth: 0.8,
    angle: 35,
    hitstun: 8,
    hitstop: 3,
    gravity: 0,
    hitTargets: [],
  };
}

describe('match state', () => {
  it('starts with three stocks and the 150-second timer', () => {
    const world = createWorld(OPTIONS);
    expect(world.fighters.map((fighter) => fighter.stocks)).toEqual([3, 3]);
    expect(world.timeFramesRemaining).toBe(150 * 60);
  });

  it('grounds stage spawns before the first input is evaluated', () => {
    const world = createWorld(OPTIONS);
    expect(world.fighters.every((fighter) => fighter.grounded)).toBe(true);
    expect(world.fighters.map((fighter) => fighter.standingPlatformId)).toEqual(['main', 'main']);

    const { events } = stepWorld(world, { p1: { ...EMPTY_COMMAND, jump: true }, p2: { ...EMPTY_COMMAND } });
    expect(events.find((event) => event.type === 'jump' && event.actorId === 'p1')?.value).toBe(1);
    expect(world.fighters[0].jumpsRemaining).toBe(1);
  });

  it('freezes every simulation value while paused', () => {
    const world = groundedWorld();
    setPaused(world, true);
    const before = JSON.stringify(world);
    stepWorld(world, { p1: { ...EMPTY_COMMAND, moveX: 1 }, p2: { ...EMPTY_COMMAND } });
    expect(JSON.stringify(world)).toBe(before);
  });

  it('allows one air jump and prevents a third jump', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    fighter.grounded = false;
    fighter.standingPlatformId = null;
    fighter.jumpsRemaining = 1;
    stepWorld(world, { p1: { ...EMPTY_COMMAND, jump: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.jumpsRemaining).toBe(0);
    const firstVelocity = fighter.velocity.y;
    stepWorld(world, emptyCommands());
    stepWorld(world, { p1: { ...EMPTY_COMMAND, jump: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.jumpsRemaining).toBe(0);
    expect(fighter.velocity.y).toBeGreaterThan(firstVelocity);
  });

  it('honors coyote time after leaving a platform', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    fighter.grounded = false;
    fighter.standingPlatformId = null;
    fighter.input.coyoteFrames = GAME_CONFIG.coyoteFrames;
    fighter.jumpsRemaining = 0;
    stepWorld(world, { p1: { ...EMPTY_COMMAND, jump: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.velocity.y).toBeLessThan(0);
    expect(fighter.input.coyoteFrames).toBe(0);
  });

  it('applies dodge invulnerability and cooldown', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    stepWorld(world, { p1: { ...EMPTY_COMMAND, dodge: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.status).toBe('dodge');
    expect(fighter.invulnerabilityFrames).toBeGreaterThan(0);
    expect(fighter.dodgeCooldownFrames).toBeGreaterThan(0);
    expect(fighter.dodgeRepeatWindowFrames).toBeGreaterThan(fighter.dodgeCooldownFrames);
  });

  it('weakens a dodge repeated shortly after its cooldown and restores it after waiting', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    stepWorld(world, { p1: { ...EMPTY_COMMAND, dodge: true }, p2: { ...EMPTY_COMMAND } });
    stepWorld(world, emptyCommands());
    while (fighter.dodgeCooldownFrames > 0) stepWorld(world, emptyCommands());
    expect(fighter.dodgeRepeatWindowFrames).toBeGreaterThan(0);

    const repeated = stepWorld(world, { p1: { ...EMPTY_COMMAND, dodge: true }, p2: { ...EMPTY_COMMAND } });
    expect(repeated.events.find((event) => event.type === 'dodge')?.value).toBe(GAME_CONFIG.repeatedDodgePenaltyFrames);
    expect(fighter.invulnerabilityFrames).toBeLessThan(GAME_CONFIG.dodgeInvulnerabilityFrames);
    expect(fighter.dodgeCooldownFrames).toBe(GAME_CONFIG.dodgeCooldownFrames + GAME_CONFIG.repeatedDodgePenaltyFrames);

    stepWorld(world, emptyCommands());
    while (fighter.dodgeRepeatWindowFrames > 0) stepWorld(world, emptyCommands());
    const recovered = stepWorld(world, { p1: { ...EMPTY_COMMAND, dodge: true }, p2: { ...EMPTY_COMMAND } });
    expect(recovered.events.find((event) => event.type === 'dodge')?.value).toBe(0);
    expect(fighter.invulnerabilityFrames).toBe(GAME_CONFIG.dodgeInvulnerabilityFrames);
  });

  it('blocks recovery-special reuse before landing', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    fighter.grounded = false;
    fighter.standingPlatformId = null;
    fighter.recoveryUsed = true;
    stepWorld(world, { p1: { ...EMPTY_COMMAND, moveY: -1, special: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.attack).toBeNull();
  });

  it('drops through a one-way platform on down input', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    fighter.position = { x: 460, y: 390 };
    fighter.previousPosition = { ...fighter.position };
    fighter.standingPlatformId = 'left-rail';
    stepWorld(world, { p1: { ...EMPTY_COMMAND, moveY: 1 }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.grounded).toBe(false);
    expect(fighter.dropThroughFrames).toBeGreaterThan(0);
  });

  it('decrements a stock and respawns after crossing a blast boundary', () => {
    const world = groundedWorld();
    world.fighters[0].lastMoveId = 'kade.jab';
    world.fighters[1].lastMoveId = 'bram.side-normal';
    world.fighters[0].dodgeRepeatWindowFrames = 20;
    world.fighters[0].position.x = getStage(world.options.stageId).blastZone.x - 1;
    const { events } = stepWorld(world, emptyCommands());
    expect(world.fighters[0].stocks).toBe(2);
    expect(world.fighters[0].status).toBe('respawn');
    expect(events.some((event) => event.type === 'ringout')).toBe(true);
    expect(events.find((event) => event.type === 'ringout')?.moveId).toBe('bram.side-normal');
    expect(world.fighters[0].dodgeRepeatWindowFrames).toBe(0);
  });

  it('resolves a simultaneous final-stock ringout without player-order bias', () => {
    const world = groundedWorld();
    const blastZone = getStage(world.options.stageId).blastZone;
    world.fighters[0].stocks = 1;
    world.fighters[1].stocks = 1;
    world.fighters[0].position.x = blastZone.x - 1;
    world.fighters[1].position.x = blastZone.x + blastZone.width + 1;
    stepWorld(world, emptyCommands());
    expect(world.ended).toBe(false);
    expect(world.inSuddenDeath).toBe(true);
    expect(world.fighters.map((fighter) => fighter.stocks)).toEqual([1, 1]);
    expect(world.fighters.map((fighter) => fighter.damage)).toEqual([180, 180]);
  });

  it('keeps infinite stocks and resets in training mode', () => {
    const world = groundedWorld();
    world.options.mode = 'training';
    world.fighters[0].position.x = -100;
    stepWorld(world, emptyCommands());
    expect(world.fighters[0].stocks).toBe(3);
    expect(world.ended).toBe(false);
  });

  it('awards a time victory by stocks, then by lower impact', () => {
    const stocks = groundedWorld();
    stocks.timeFramesRemaining = 1;
    stocks.fighters[0].stocks = 2;
    stocks.fighters[1].stocks = 1;
    stepWorld(stocks, emptyCommands());
    expect(stocks.result).toMatchObject({ winnerId: 'p1', reason: 'time' });

    const impact = groundedWorld();
    impact.timeFramesRemaining = 1;
    impact.fighters[0].damage = 20;
    impact.fighters[1].damage = 80;
    stepWorld(impact, emptyCommands());
    expect(impact.result?.winnerId).toBe('p1');
  });

  it('enters sudden death when stocks and impact are tied', () => {
    const world = groundedWorld();
    world.timeFramesRemaining = 1;
    stepWorld(world, emptyCommands());
    expect(world.inSuddenDeath).toBe(true);
    expect(world.fighters.every((fighter) => fighter.damage === 180 && fighter.stocks === 1)).toBe(true);
  });

  it('disables attacks after the match result', () => {
    const world = groundedWorld();
    forceMatchEnd(world, 'p1');
    const tick = world.tick;
    stepWorld(world, { p1: { ...EMPTY_COMMAND, normal: true }, p2: { ...EMPTY_COMMAND } });
    expect(world.tick).toBe(tick);
    expect(world.projectiles).toHaveLength(0);
    expect(world.fighters[0].status).toBe('victory');
  });

  it('resets training positions without erasing impact or session telemetry', () => {
    const world = groundedWorld();
    world.options.mode = 'training';
    world.fighters[0].damage = 199;
    resetTrainingDamage(world);
    expect(world.fighters[0].damage).toBe(0);
    world.fighters[0].damage = 73;
    world.fighters[0].totalDamageDealt = 42;
    world.fighters[0].hitsLanded = 3;
    world.fighters[0].recoveriesAttempted = 2;
    world.fighters[0].recoveriesSucceeded = 1;
    world.fighters[0].moveCooldowns['kade.down-special'] = 19;
    world.fighters[0].position.x = 999;
    resetTrainingPositions(world);
    expect(world.fighters[0].position).toEqual(getStage(world.options.stageId).spawnPoints[0]);
    expect(world.fighters[0].grounded).toBe(true);
    expect(world.fighters[0].standingPlatformId).toBe('main');
    expect(world.fighters[0]).toMatchObject({
      damage: 73,
      totalDamageDealt: 42,
      hitsLanded: 3,
      recoveriesAttempted: 2,
      recoveriesSucceeded: 1,
      moveCooldowns: { 'kade.down-special': 19 },
    });
    const { events } = stepWorld(world, { p1: { ...EMPTY_COMMAND, jump: true }, p2: { ...EMPTY_COMMAND } });
    expect(events.find((event) => event.type === 'jump' && event.actorId === 'p1')?.value).toBe(1);
    expect(world.fighters[0].jumpsRemaining).toBe(1);
  });
});

describe('hit resolution', () => {
  it('cancels jab recovery on a fresh normal press without retriggering while held', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    const jab = getFighter(fighter.definitionId).moves.jab;
    if (jab === undefined) throw new Error('Missing jab.');
    const recoveryStart = jab.startupFrames + jab.activeFrames;
    fighter.status = 'attack';
    fighter.attack = { moveId: jab.id, frame: recoveryStart, chargeRatio: 0, hitTargets: [], projectileSpawned: false };

    const cancelled = stepWorld(world, { p1: { ...EMPTY_COMMAND, normal: true }, p2: { ...EMPTY_COMMAND } });
    expect(cancelled.events.filter((event) => event.type === 'attack-start' && event.actorId === 'p1')).toHaveLength(1);
    expect(fighter.attack).toMatchObject({ moveId: jab.id, frame: 1 });

    if (fighter.attack === null) throw new Error('Expected the cancelled jab to remain active.');
    fighter.attack.frame = recoveryStart;
    const held = stepWorld(world, { p1: { ...EMPTY_COMMAND, normal: true }, p2: { ...EMPTY_COMMAND } });
    expect(held.events.some((event) => event.type === 'attack-start' && event.actorId === 'p1')).toBe(false);
    expect(fighter.attack).toMatchObject({ moveId: jab.id, frame: recoveryStart + 1 });
  });

  it('does not cancel a jab before its recovery window', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    const jab = getFighter(fighter.definitionId).moves.jab;
    if (jab === undefined) throw new Error('Missing jab.');
    const recoveryStart = jab.startupFrames + jab.activeFrames;
    fighter.status = 'attack';
    fighter.attack = { moveId: jab.id, frame: recoveryStart - 1, chargeRatio: 0, hitTargets: [], projectileSpawned: false };

    const result = stepWorld(world, { p1: { ...EMPTY_COMMAND, normal: true }, p2: { ...EMPTY_COMMAND } });
    expect(result.events.some((event) => event.type === 'attack-start' && event.actorId === 'p1')).toBe(false);
    expect(fighter.attack).toMatchObject({ moveId: jab.id, frame: recoveryStart });
  });

  it('separates generated hitboxes from hurtboxes', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    const move = getFighter(fighter.definitionId).moves.sideNormal;
    if (move === undefined) throw new Error('Missing side normal.');
    const box = attackHitbox(fighter, move);
    expect(box.x).toBeGreaterThan(fighter.position.x);
    fighter.facing = -1;
    expect(attackHitbox(fighter, move).x).toBeLessThan(fighter.position.x);
  });

  it('prevents duplicate hits during one active window', () => {
    const world = groundedWorld();
    world.fighters[0].position.x = 600;
    world.fighters[1].position.x = 650;
    armAttack(world.fighters[0], 'sideNormal');
    stepWorld(world, emptyCommands());
    const damage = world.fighters[1].damage;
    expect(damage).toBeGreaterThan(0);
    stepWorld(world, emptyCommands());
    expect(world.fighters[1].damage).toBe(damage);
  });

  it('globally freezes fighters, projectiles, timer, and stage motion for every hitstop frame', () => {
    const world = groundedWorld();
    const attacker = world.fighters[0];
    const defender = world.fighters[1];
    attacker.position.x = 600;
    attacker.velocity.x = 4;
    defender.position.x = 650;
    world.projectiles = [{
      ...projectileAt(defender, 'p1'),
      id: 99,
      position: { x: 200, y: 200 },
      velocity: { x: 3, y: 1 },
    }];
    armAttack(attacker, 'sideNormal');
    stepWorld(world, emptyCommands());

    expect(defender.hitstopFrames).toBeGreaterThan(0);
    const frozenFighters = world.fighters.map((fighter) => ({ position: { ...fighter.position }, velocity: { ...fighter.velocity } }));
    const frozenProjectile = { position: { ...world.projectiles[0]?.position }, lifetimeFrames: world.projectiles[0]?.lifetimeFrames };
    const frozenTimer = world.timeFramesRemaining;
    const frozenMotionTick = world.motionTick;
    const hitstopFrames = defender.hitstopFrames;
    for (let remaining = hitstopFrames; remaining > 0; remaining -= 1) {
      stepWorld(world, emptyCommands());
      expect(world.fighters.map((fighter) => ({ position: fighter.position, velocity: fighter.velocity }))).toEqual(frozenFighters);
      expect(world.projectiles[0]).toMatchObject(frozenProjectile);
      expect(world.timeFramesRemaining).toBe(frozenTimer);
      expect(world.motionTick).toBe(frozenMotionTick);
      expect(defender.hitstopFrames).toBe(remaining - 1);
    }

    stepWorld(world, emptyCommands());
    expect(world.fighters.map((fighter) => ({ position: fighter.position, velocity: fighter.velocity }))).not.toEqual(frozenFighters);
    expect(world.projectiles[0]?.position).not.toEqual(frozenProjectile.position);
    expect(world.projectiles[0]?.lifetimeFrames).toBe((frozenProjectile.lifetimeFrames ?? 0) - 1);
    expect(world.timeFramesRemaining).toBe(frozenTimer - 1);
    expect(world.motionTick).toBe(frozenMotionTick + 1);
  });

  it('ignores hits throughout invulnerability frames', () => {
    const world = groundedWorld();
    world.fighters[0].position.x = 600;
    world.fighters[1].position.x = 650;
    world.fighters[1].invulnerabilityFrames = 10;
    armAttack(world.fighters[0], 'sideNormal');
    stepWorld(world, emptyCommands());
    expect(world.fighters[1].damage).toBe(0);
  });

  it('lets finite super armor absorb launch but not damage', () => {
    const world = groundedWorld();
    world.fighters[0].position.x = 600;
    world.fighters[1].position.x = 650;
    world.fighters[1].armorFrames = 5;
    armAttack(world.fighters[0], 'sideNormal');
    stepWorld(world, emptyCommands());
    expect(world.fighters[1].damage).toBeGreaterThan(0);
    expect(world.fighters[1].status).not.toBe('hurt');
  });

  it('launches projectile hits along their travel direction after the owner turns', () => {
    const world = groundedWorld();
    const owner = world.fighters[0];
    const defender = world.fighters[1];
    owner.facing = -1;
    world.projectiles = [projectileAt(defender, owner.id)];

    stepWorld(world, emptyCommands());

    expect(defender.damage).toBeGreaterThan(0);
    expect(defender.velocity.x).toBeGreaterThan(0);
  });

  it('applies an aerial move landing lag when the fighter lands during the move', () => {
    const world = groundedWorld();
    const fighter = world.fighters[0];
    const move = getFighter(fighter.definitionId).moves.airNormal;
    if (move === undefined) throw new Error('Missing air normal.');
    fighter.grounded = false;
    fighter.standingPlatformId = null;
    fighter.position.y = 512;
    fighter.previousPosition.y = 512;
    fighter.velocity.y = 8;
    fighter.status = 'attack';
    fighter.attack = { moveId: move.id, frame: 0, chargeRatio: 0, hitTargets: [], projectileSpawned: false };
    stepWorld(world, emptyCommands());
    expect(fighter.grounded).toBe(true);
    expect(fighter.attack).toBeNull();
    expect(fighter.landingLagFrames).toBe(move.landingLagFrames);
    stepWorld(world, { p1: { ...EMPTY_COMMAND, normal: true }, p2: { ...EMPTY_COMMAND } });
    expect(fighter.attack).toBeNull();
  });

  it('reflects projectiles only during the move active window', () => {
    const startup = groundedWorld();
    const startupDefender = startup.fighters[0];
    const guard = getFighter(startupDefender.definitionId).moves.downSpecial;
    if (guard === undefined) throw new Error('Missing reflection guard.');
    startupDefender.status = 'attack';
    startupDefender.attack = { moveId: guard.id, frame: 0, chargeRatio: 0, hitTargets: [], projectileSpawned: false };
    startup.projectiles = [projectileAt(startupDefender, 'p2')];
    stepWorld(startup, emptyCommands());
    expect(startupDefender.damage).toBeGreaterThan(0);
    expect(startup.projectiles).toHaveLength(0);

    const active = groundedWorld();
    const activeDefender = active.fighters[0];
    activeDefender.status = 'attack';
    activeDefender.attack = { moveId: guard.id, frame: guard.startupFrames - 1, chargeRatio: 0, hitTargets: [], projectileSpawned: false };
    active.projectiles = [projectileAt(activeDefender, 'p2')];
    stepWorld(active, emptyCommands());
    expect(activeDefender.damage).toBe(0);
    expect(active.projectiles[0]?.ownerId).toBe('p1');
  });
});
