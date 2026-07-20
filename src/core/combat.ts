import { GAME_CONFIG } from './config';
import { advanceInputMemory, consumeBuffered, createInputMemory, hasBuffered, sanitizeCommand } from './input';
import { angleToVector, calculateHitstun, calculateKnockback, circleIntersectsRect, clamp, rectanglesOverlap, safeNumber } from './math';
import type {
  AttackState,
  CombatEvent,
  FighterInstanceId,
  FighterState,
  InputCommand,
  MatchOptions,
  MatchResult,
  MoveDefinition,
  PlatformDefinition,
  ProjectileState,
  Rect,
  StageDefinition,
  StepResult,
  WorldState,
} from './types';
import { EMPTY_COMMAND } from './types';
import { getFighter } from '../data/fighters';
import { getStage, platformAtTick } from '../data/stages';

function cloneCommand(command: Readonly<InputCommand>): InputCommand {
  return {
    moveX: command.moveX,
    moveY: command.moveY,
    normal: command.normal,
    special: command.special,
    jump: command.jump,
    dodge: command.dodge,
    pause: command.pause,
  };
}

export function createFighterState(
  id: FighterInstanceId,
  definitionId: MatchOptions['fighterOne'],
  position: { x: number; y: number },
): FighterState {
  return {
    id,
    team: id === 'p1' ? 1 : 2,
    definitionId,
    position: { ...position },
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    facing: id === 'p1' ? 1 : -1,
    status: 'idle',
    grounded: false,
    standingPlatformId: null,
    damage: 0,
    stocks: GAME_CONFIG.startingStocks,
    jumpsRemaining: 1,
    hitstunFrames: 0,
    hitstopFrames: 0,
    invulnerabilityFrames: 0,
    armorFrames: 0,
    dodgeCooldownFrames: 0,
    dodgeRepeatWindowFrames: 0,
    recoveryUsed: false,
    recoveryAttemptActive: false,
    landingLagFrames: 0,
    dropThroughFrames: 0,
    comboHits: 0,
    comboDecayFrames: 0,
    attack: null,
    input: createInputMemory(),
    lastHitBy: null,
    lastMoveId: null,
    moveCooldowns: {},
    totalDamageDealt: 0,
    hitsLanded: 0,
    recoveriesAttempted: 0,
    recoveriesSucceeded: 0,
  };
}

function createSpawnedFighter(
  id: FighterInstanceId,
  definitionId: MatchOptions['fighterOne'],
  stage: StageDefinition,
  spawnIndex: 0 | 1,
  tick: number,
  hazards: boolean,
): FighterState {
  const spawnPoint = stage.spawnPoints[spawnIndex];
  const fighter = createFighterState(id, definitionId, spawnPoint);
  const sourcePlatform = stage.platforms.find((platform) => (
    spawnPoint.x >= platform.x
    && spawnPoint.x <= platform.x + platform.width
    && Math.abs(spawnPoint.y - platform.y) <= 6
  ));
  if (sourcePlatform === undefined) return fighter;

  const platform = platformAtTick(sourcePlatform, tick, hazards);
  fighter.position.x += platform.x - sourcePlatform.x;
  fighter.position.y = platform.y;
  fighter.previousPosition = { ...fighter.position };
  fighter.grounded = true;
  fighter.standingPlatformId = platform.id;
  return fighter;
}

export function createWorld(options: MatchOptions): WorldState {
  const stage = getStage(options.stageId);
  return {
    tick: 0,
    motionTick: 0,
    timeFramesRemaining: GAME_CONFIG.matchFrames,
    suddenDeathFramesRemaining: GAME_CONFIG.suddenDeathFrames,
    inSuddenDeath: false,
    paused: false,
    ended: false,
    result: null,
    options: { ...options },
    fighters: [
      createSpawnedFighter('p1', options.fighterOne, stage, 0, 0, options.hazards),
      createSpawnedFighter('p2', options.fighterTwo, stage, 1, 0, options.hazards),
    ],
    projectiles: [],
    nextProjectileId: 1,
    training: {
      behavior: 'stand',
      showHitboxes: false,
      showFrameData: false,
      showInputs: false,
    },
  };
}

export function fighterHurtbox(fighter: FighterState): Rect {
  const definition = getFighter(fighter.definitionId);
  return {
    x: fighter.position.x - definition.stats.width / 2,
    y: fighter.position.y - definition.stats.height,
    width: definition.stats.width,
    height: definition.stats.height,
  };
}

export function attackHitbox(fighter: FighterState, move: MoveDefinition): Rect {
  const x = fighter.facing === 1
    ? fighter.position.x + move.hitbox.x
    : fighter.position.x - move.hitbox.x - move.hitbox.width;
  return {
    x,
    y: fighter.position.y + move.hitbox.y,
    width: move.hitbox.width,
    height: move.hitbox.height,
  };
}

function getMove(fighter: FighterState, moveId: string): MoveDefinition {
  const move = Object.values(getFighter(fighter.definitionId).moves).find((candidate) => candidate.id === moveId);
  if (move === undefined) throw new Error(`Unknown move ${moveId} for ${fighter.definitionId}.`);
  return move;
}

export function selectMove(fighter: FighterState, command: InputCommand, special: boolean): MoveDefinition {
  const moves = getFighter(fighter.definitionId).moves;
  if (!fighter.grounded && !special) return requiredMove(moves.airNormal, fighter.definitionId, 'airNormal');
  const vertical = command.moveY;
  const horizontal = Math.abs(command.moveX);
  let key: string;
  if (vertical < -GAME_CONFIG.directionThreshold) key = special ? 'upSpecial' : 'upNormal';
  else if (vertical > GAME_CONFIG.directionThreshold) key = special ? 'downSpecial' : 'downNormal';
  else if (horizontal > GAME_CONFIG.directionThreshold) key = special ? 'sideSpecial' : 'sideNormal';
  else key = special ? 'neutralSpecial' : 'jab';
  return requiredMove(moves[key], fighter.definitionId, key);
}

function requiredMove(move: MoveDefinition | undefined, fighterId: string, key: string): MoveDefinition {
  if (move === undefined) throw new Error(`Missing move ${key} for ${fighterId}.`);
  return move;
}

function isActionable(fighter: FighterState): boolean {
  return fighter.status === 'idle' || fighter.status === 'run' || fighter.status === 'jump' || fighter.status === 'fall';
}

function decrementTimers(fighter: FighterState): void {
  fighter.invulnerabilityFrames = Math.max(0, fighter.invulnerabilityFrames - 1);
  fighter.armorFrames = Math.max(0, fighter.armorFrames - 1);
  fighter.dodgeCooldownFrames = Math.max(0, fighter.dodgeCooldownFrames - 1);
  fighter.dodgeRepeatWindowFrames = Math.max(0, fighter.dodgeRepeatWindowFrames - 1);
  if (fighter.grounded) fighter.landingLagFrames = Math.max(0, fighter.landingLagFrames - 1);
  fighter.dropThroughFrames = Math.max(0, fighter.dropThroughFrames - 1);
  if (fighter.comboDecayFrames > 0) fighter.comboDecayFrames -= 1;
  else fighter.comboHits = 0;
  for (const moveId of Object.keys(fighter.moveCooldowns)) {
    const value = fighter.moveCooldowns[moveId];
    if (value === undefined || value <= 1) delete fighter.moveCooldowns[moveId];
    else fighter.moveCooldowns[moveId] = value - 1;
  }
}

function beginAttack(fighter: FighterState, move: MoveDefinition, chargeRatio: number, events: CombatEvent[]): boolean {
  if ((fighter.moveCooldowns[move.id] ?? 0) > 0) return false;
  if (move.id.endsWith('up-special') && fighter.recoveryUsed && !fighter.grounded) return false;
  if (!fighter.grounded) fighter.landingLagFrames = 0;
  const attack: AttackState = {
    moveId: move.id,
    frame: 0,
    chargeRatio: clamp(chargeRatio, 0, 1),
    hitTargets: [],
    projectileSpawned: false,
  };
  fighter.attack = attack;
  fighter.status = 'attack';
  fighter.lastMoveId = move.id;
  fighter.moveCooldowns[move.id] = move.cooldown;
  fighter.velocity.x += move.movementImpulse.x * fighter.facing;
  fighter.velocity.y += move.movementImpulse.y;
  fighter.armorFrames = Math.max(fighter.armorFrames, move.armorFrames);
  fighter.invulnerabilityFrames = Math.max(fighter.invulnerabilityFrames, move.invulnerabilityFrames);
  if (move.id.endsWith('up-special') && !fighter.grounded) {
    fighter.recoveryUsed = true;
    const attemptingRecovery = fighter.position.y > 500 || fighter.position.x < 260 || fighter.position.x > 1020;
    if (attemptingRecovery) {
      fighter.recoveryAttemptActive = true;
      fighter.recoveriesAttempted += 1;
    }
  }
  events.push({ type: 'attack-start', tick: 0, actorId: fighter.id, targetId: null, position: { ...fighter.position }, value: chargeRatio, moveId: move.id });
  return true;
}

function beginDodge(fighter: FighterState, command: InputCommand, events: CombatEvent[]): void {
  const repeatedPenalty = fighter.dodgeRepeatWindowFrames > 0 ? GAME_CONFIG.repeatedDodgePenaltyFrames : 0;
  fighter.status = 'dodge';
  fighter.hitstunFrames = GAME_CONFIG.dodgeDurationFrames + repeatedPenalty;
  fighter.invulnerabilityFrames = Math.max(4, GAME_CONFIG.dodgeInvulnerabilityFrames - Math.floor(repeatedPenalty / 6));
  fighter.dodgeCooldownFrames = GAME_CONFIG.dodgeCooldownFrames + repeatedPenalty;
  fighter.dodgeRepeatWindowFrames = fighter.dodgeCooldownFrames + GAME_CONFIG.repeatedDodgePenaltyFrames;
  const direction = Math.abs(command.moveX) > GAME_CONFIG.directionThreshold ? Math.sign(command.moveX) : -fighter.facing;
  fighter.velocity.x = direction * (repeatedPenalty > 0 ? 5.2 : 8.2);
  events.push({ type: 'dodge', tick: 0, actorId: fighter.id, targetId: null, position: { ...fighter.position }, value: repeatedPenalty, moveId: null });
}

function updateControl(fighter: FighterState, command: InputCommand, events: CombatEvent[]): void {
  const definition = getFighter(fighter.definitionId);
  const edges = advanceInputMemory(fighter.input, command);
  if (fighter.grounded) fighter.input.coyoteFrames = GAME_CONFIG.coyoteFrames;
  else fighter.input.coyoteFrames = Math.max(0, fighter.input.coyoteFrames - 1);

  if (fighter.status === 'charge') {
    fighter.input.chargeFrames = Math.min(GAME_CONFIG.maxChargeFrames, fighter.input.chargeFrames + 1);
    if (edges.released.normal || fighter.input.chargeFrames >= GAME_CONFIG.maxChargeFrames) {
      const move = selectMove(fighter, command, false);
      beginAttack(fighter, move, fighter.input.chargeFrames / GAME_CONFIG.maxChargeFrames, events);
      fighter.input.chargeFrames = 0;
      consumeBuffered(fighter.input, 'normal');
    }
    return;
  }

  if (fighter.status === 'attack' && fighter.attack !== null && edges.pressed.normal) {
    const currentMove = getMove(fighter, fighter.attack.moveId);
    const recoveryStart = currentMove.startupFrames + currentMove.activeFrames;
    if (fighter.attack.frame >= recoveryStart && currentMove.cancelRules.includes('normal')) {
      const selected = selectMove(fighter, command, false);
      if (beginAttack(fighter, selected, 0, events)) consumeBuffered(fighter.input, 'normal');
      return;
    }
  }

  if (fighter.status === 'hurt' || fighter.status === 'dodge' || fighter.status === 'respawn' || (fighter.grounded && fighter.landingLagFrames > 0)) return;
  if (!isActionable(fighter)) return;

  if (Math.abs(command.moveX) > GAME_CONFIG.directionThreshold) fighter.facing = command.moveX >= 0 ? 1 : -1;

  if (hasBuffered(fighter.input, 'dodge') && fighter.dodgeCooldownFrames === 0) {
    consumeBuffered(fighter.input, 'dodge');
    beginDodge(fighter, command, events);
    return;
  }

  if (hasBuffered(fighter.input, 'jump')) {
    const canGroundJump = fighter.grounded || fighter.input.coyoteFrames > 0;
    if (canGroundJump || fighter.jumpsRemaining > 0) {
      if (!canGroundJump) fighter.jumpsRemaining -= 1;
      fighter.velocity.y = canGroundJump ? -definition.stats.jumpSpeed : -definition.stats.doubleJumpSpeed;
      fighter.grounded = false;
      fighter.standingPlatformId = null;
      fighter.status = 'jump';
      fighter.input.coyoteFrames = 0;
      consumeBuffered(fighter.input, 'jump');
      events.push({ type: 'jump', tick: 0, actorId: fighter.id, targetId: null, position: { ...fighter.position }, value: canGroundJump ? 1 : 2, moveId: null });
      return;
    }
  }

  if (hasBuffered(fighter.input, 'special')) {
    const selected = selectMove(fighter, command, true);
    if (beginAttack(fighter, selected, 0, events)) consumeBuffered(fighter.input, 'special');
    return;
  }

  if (hasBuffered(fighter.input, 'normal')) {
    if (fighter.grounded) {
      fighter.status = 'charge';
      fighter.input.chargeFrames = 0;
    } else {
      const selected = selectMove(fighter, command, false);
      if (beginAttack(fighter, selected, 0, events)) consumeBuffered(fighter.input, 'normal');
    }
    return;
  }

  if (fighter.grounded && command.moveY > GAME_CONFIG.fastFallThreshold && fighter.standingPlatformId !== 'main') {
    fighter.grounded = false;
    fighter.standingPlatformId = null;
    fighter.dropThroughFrames = GAME_CONFIG.platformDropFrames;
    fighter.position.y += 7;
  }

  const acceleration = fighter.grounded ? definition.stats.acceleration : definition.stats.airAcceleration;
  const maxSpeed = fighter.grounded ? definition.stats.runSpeed : definition.stats.airSpeed;
  const desired = command.moveX * maxSpeed;
  fighter.velocity.x += clamp(desired - fighter.velocity.x, -acceleration, acceleration);
  if (Math.abs(command.moveX) > 0.12) {
    fighter.facing = command.moveX >= 0 ? 1 : -1;
    fighter.status = fighter.grounded ? 'run' : fighter.velocity.y < 0 ? 'jump' : 'fall';
  } else if (fighter.grounded) {
    fighter.status = 'idle';
  }
  if (!fighter.grounded && command.moveY > GAME_CONFIG.fastFallThreshold && fighter.velocity.y > 0) {
    fighter.velocity.y = Math.max(fighter.velocity.y, definition.stats.fastFallSpeed);
  }
}

function updateSpecialStates(fighter: FighterState): void {
  if (fighter.status === 'hurt' || fighter.status === 'dodge') {
    fighter.hitstunFrames = Math.max(0, fighter.hitstunFrames - 1);
    if (fighter.hitstunFrames === 0) fighter.status = fighter.grounded ? 'idle' : 'fall';
  }
  if (fighter.status === 'respawn') {
    fighter.hitstunFrames = Math.max(0, fighter.hitstunFrames - 1);
    if (fighter.hitstunFrames === 0) {
      fighter.status = 'fall';
      fighter.invulnerabilityFrames = GAME_CONFIG.respawnInvulnerabilityFrames;
    }
  }
}

function activeMove(fighter: FighterState): MoveDefinition | null {
  if (fighter.attack === null) return null;
  const move = getMove(fighter, fighter.attack.moveId);
  const frame = fighter.attack.frame;
  return frame >= move.startupFrames && frame < move.startupFrames + move.activeFrames ? move : null;
}

function spawnProjectile(state: WorldState, fighter: FighterState, move: MoveDefinition, events: CombatEvent[]): void {
  const definition = move.projectile;
  if (definition === null || fighter.attack === null || fighter.attack.projectileSpawned) return;
  const existing = state.projectiles.filter((projectile) => projectile.ownerId === fighter.id && projectile.moveId === move.id).length;
  if (existing >= definition.maxActive || state.projectiles.length >= GAME_CONFIG.projectileLimitGlobal) {
    fighter.attack.projectileSpawned = true;
    return;
  }
  fighter.attack.projectileSpawned = true;
  const projectile: ProjectileState = {
    id: state.nextProjectileId,
    ownerId: fighter.id,
    moveId: move.id,
    position: { x: fighter.position.x + fighter.facing * 42, y: fighter.position.y - 50 },
    velocity: { x: definition.speed * fighter.facing, y: move.id.includes('side-special') ? -0.4 : -0.9 },
    radius: definition.radius,
    lifetimeFrames: definition.lifetimeFrames,
    damage: move.damage,
    baseKnockback: move.baseKnockback,
    knockbackGrowth: move.knockbackGrowth,
    angle: move.angle,
    hitstun: move.hitstun,
    hitstop: move.hitstop,
    gravity: definition.gravity,
    hitTargets: [],
  };
  state.nextProjectileId += 1;
  state.projectiles.push(projectile);
  events.push({ type: 'projectile', tick: 0, actorId: fighter.id, targetId: null, position: { ...projectile.position }, value: 0, moveId: move.id });
}

function updateAttack(state: WorldState, fighter: FighterState, events: CombatEvent[]): void {
  if (fighter.attack === null) return;
  const move = getMove(fighter, fighter.attack.moveId);
  fighter.attack.frame += 1;
  if (fighter.attack.frame === move.startupFrames) spawnProjectile(state, fighter, move, events);
  const totalFrames = move.startupFrames + move.activeFrames + move.recoveryFrames;
  if (fighter.attack.frame >= totalFrames) {
    if (!fighter.grounded) fighter.landingLagFrames = Math.max(fighter.landingLagFrames, move.landingLagFrames);
    fighter.attack = null;
    fighter.status = fighter.grounded ? 'idle' : 'fall';
  }
}

function movePriority(move: MoveDefinition): number {
  return move.damage * 0.55 + move.range * 0.018 + move.armorFrames * 0.14 - move.startupFrames * 0.11;
}

interface HitCandidate {
  attacker: FighterState;
  defender: FighterState;
  move: MoveDefinition;
  chargeRatio: number;
}

function collectMeleeHits(state: WorldState): HitCandidate[] {
  const candidates: HitCandidate[] = [];
  for (const attacker of state.fighters) {
    const move = activeMove(attacker);
    if (move === null || attacker.attack === null) continue;
    for (const defender of state.fighters) {
      if (attacker.id === defender.id || attacker.team === defender.team || defender.status === 'respawn') continue;
      if (attacker.attack.hitTargets.includes(defender.id)) continue;
      if (rectanglesOverlap(attackHitbox(attacker, move), fighterHurtbox(defender))) {
        candidates.push({ attacker, defender, move, chargeRatio: attacker.attack.chargeRatio });
      }
    }
  }
  return candidates;
}

function applyHit(
  attacker: FighterState,
  defender: FighterState,
  move: Pick<MoveDefinition, 'id' | 'damage' | 'baseKnockback' | 'knockbackGrowth' | 'angle' | 'hitstun' | 'hitstop'>,
  chargeRatio: number,
  defenderCommand: InputCommand,
  events: CombatEvent[],
  launchFacing: -1 | 1 = attacker.facing,
): void {
  if (defender.invulnerabilityFrames > 0 || defender.status === 'ko' || defender.status === 'victory') return;
  const attackerMoveState = attacker.attack;
  if (attackerMoveState !== null && !attackerMoveState.hitTargets.includes(defender.id)) attackerMoveState.hitTargets.push(defender.id);
  const damage = move.damage * (1 + chargeRatio * 0.24);
  defender.damage = clamp(defender.damage + damage, 0, GAME_CONFIG.maxDamage);
  attacker.totalDamageDealt += damage;
  attacker.hitsLanded += 1;
  defender.comboHits += 1;
  defender.comboDecayFrames = GAME_CONFIG.comboDecayFrames;
  defender.lastHitBy = attacker.id;
  const defenderDefinition = getFighter(defender.definitionId);
  const knockback = calculateKnockback({
    accumulatedDamage: defender.damage,
    attackDamage: damage,
    baseKnockback: move.baseKnockback,
    knockbackGrowth: move.knockbackGrowth,
    defenderWeight: defenderDefinition.stats.weight,
    chargeRatio,
    comboHits: defender.comboHits,
  });
  const baseDirection = angleToVector(move.angle, launchFacing);
  const influenceX = clamp(defenderCommand.moveX, -1, 1) * 0.12;
  const influenceY = clamp(defenderCommand.moveY, -1, 1) * 0.08;
  if (defender.armorFrames === 0) {
    defender.velocity.x = clamp((baseDirection.x + influenceX) * knockback, -GAME_CONFIG.maxHorizontalVelocity, GAME_CONFIG.maxHorizontalVelocity);
    defender.velocity.y = clamp((baseDirection.y + influenceY) * knockback, -GAME_CONFIG.maxVerticalVelocity, GAME_CONFIG.maxVerticalVelocity);
    defender.hitstunFrames = calculateHitstun(move.hitstun, knockback, defender.comboHits);
    defender.status = 'hurt';
    defender.attack = null;
    defender.grounded = false;
    defender.standingPlatformId = null;
  }
  const stop = Math.round(clamp(move.hitstop + chargeRatio * 3, 1, 12));
  attacker.hitstopFrames = Math.max(attacker.hitstopFrames, stop);
  defender.hitstopFrames = Math.max(defender.hitstopFrames, stop);
  events.push({
    type: knockback >= 11 ? 'strong-hit' : 'hit',
    tick: 0,
    actorId: attacker.id,
    targetId: defender.id,
    position: { x: defender.position.x, y: defender.position.y - defenderDefinition.stats.height * 0.55 },
    value: knockback,
    moveId: move.id,
  });
}

function resolveMeleeHits(candidates: HitCandidate[], commands: Readonly<Record<FighterInstanceId, InputCommand>>, events: CombatEvent[]): void {
  if (candidates.length === 2) {
    const first = candidates[0];
    const second = candidates[1];
    if (first !== undefined && second !== undefined && first.attacker.id === second.defender.id && second.attacker.id === first.defender.id) {
      const difference = movePriority(first.move) - movePriority(second.move);
      if (difference > 1.25) {
        applyHit(first.attacker, first.defender, first.move, first.chargeRatio, commands[first.defender.id], events);
        return;
      }
      if (difference < -1.25) {
        applyHit(second.attacker, second.defender, second.move, second.chargeRatio, commands[second.defender.id], events);
        return;
      }
    }
  }
  for (const candidate of candidates) {
    applyHit(candidate.attacker, candidate.defender, candidate.move, candidate.chargeRatio, commands[candidate.defender.id], events);
  }
}

function updateProjectiles(state: WorldState, commands: Readonly<Record<FighterInstanceId, InputCommand>>, events: CombatEvent[]): void {
  const survivors: ProjectileState[] = [];
  for (const projectile of state.projectiles) {
    const owner = state.fighters.find((fighter) => fighter.id === projectile.ownerId);
    if (owner === undefined) continue;
    projectile.velocity.y += projectile.gravity;
    projectile.position.x += projectile.velocity.x;
    projectile.position.y += projectile.velocity.y;
    projectile.lifetimeFrames -= 1;
    let consumed = false;
    for (const defender of state.fighters) {
      if (defender.id === owner.id || defender.team === owner.team || projectile.hitTargets.includes(defender.id)) continue;
      if (circleIntersectsRect(projectile.position, projectile.radius, fighterHurtbox(defender))) {
        const guardMove = activeMove(defender);
        const phasing = guardMove?.projectileInvulnerability === true;
        if (phasing) continue;
        const guarding = guardMove?.reflectProjectiles === true;
        if (guarding) {
          projectile.ownerId = defender.id;
          projectile.velocity.x = -projectile.velocity.x * 1.12;
          projectile.velocity.y *= -0.35;
          projectile.damage *= 1.08;
          projectile.baseKnockback *= 1.04;
          projectile.knockbackGrowth *= 1.05;
          projectile.hitTargets = [defender.id];
          projectile.position.x += Math.sign(projectile.velocity.x) * (projectile.radius + 8);
          events.push({ type: 'projectile', tick: 0, actorId: defender.id, targetId: owner.id, position: { ...projectile.position }, value: 1, moveId: guardMove.id });
          break;
        }
        projectile.hitTargets.push(defender.id);
        applyHit(owner, defender, {
          id: projectile.moveId,
          damage: projectile.damage,
          baseKnockback: projectile.baseKnockback,
          knockbackGrowth: projectile.knockbackGrowth,
          angle: projectile.angle,
          hitstun: projectile.hitstun,
          hitstop: projectile.hitstop,
        }, 0, commands[defender.id], events, projectile.velocity.x < 0 ? -1 : 1);
        consumed = true;
        break;
      }
    }
    if (!consumed && projectile.lifetimeFrames > 0 && projectile.position.x > -80 && projectile.position.x < GAME_CONFIG.worldWidth + 80) {
      survivors.push(projectile);
    }
  }
  state.projectiles = survivors;
}

function activePlatforms(state: WorldState): PlatformDefinition[] {
  const stage = getStage(state.options.stageId);
  return stage.platforms.map((platform) => platformAtTick(platform, state.motionTick, state.options.hazards));
}

function applyPlatformCarry(state: WorldState, fighter: FighterState): void {
  if (!fighter.grounded || fighter.standingPlatformId === null) return;
  const stage = getStage(state.options.stageId);
  const source = stage.platforms.find((platform) => platform.id === fighter.standingPlatformId);
  if (source === undefined || source.moving === null || !state.options.hazards) return;
  const current = platformAtTick(source, state.motionTick, true);
  const previous = platformAtTick(source, Math.max(0, state.motionTick - 1), true);
  fighter.position.x += current.x - previous.x;
  fighter.position.y += current.y - previous.y;
}

function applyPhysics(state: WorldState, fighter: FighterState, command: InputCommand, events: CombatEvent[]): void {
  if (fighter.status === 'respawn' || fighter.status === 'ko' || fighter.status === 'victory') return;
  const definition = getFighter(fighter.definitionId);
  applyPlatformCarry(state, fighter);
  fighter.previousPosition.x = fighter.position.x;
  fighter.previousPosition.y = fighter.position.y;
  if (!fighter.grounded) {
    const lowJumpGravity = command.jump && fighter.velocity.y < 0 ? GAME_CONFIG.gravity * 0.62 : GAME_CONFIG.gravity;
    fighter.velocity.y += lowJumpGravity;
    fighter.velocity.x *= GAME_CONFIG.airFriction;
  } else {
    fighter.velocity.x *= GAME_CONFIG.groundFriction;
  }
  fighter.velocity.x = clamp(fighter.velocity.x, -GAME_CONFIG.maxHorizontalVelocity, GAME_CONFIG.maxHorizontalVelocity);
  const fallCap = command.moveY > GAME_CONFIG.fastFallThreshold ? definition.stats.fastFallSpeed : definition.stats.maxFallSpeed;
  fighter.velocity.y = clamp(fighter.velocity.y, -GAME_CONFIG.maxVerticalVelocity, Math.min(fallCap, GAME_CONFIG.terminalVelocity));
  fighter.position.x = safeNumber(fighter.position.x + fighter.velocity.x, GAME_CONFIG.worldWidth / 2);
  fighter.position.y = safeNumber(fighter.position.y + fighter.velocity.y, 120);

  const previousBottom = fighter.previousPosition.y;
  const descending = fighter.velocity.y >= 0;
  let landedOn: PlatformDefinition | null = null;
  if (descending && fighter.dropThroughFrames === 0) {
    for (const platform of activePlatforms(state)) {
      const horizontalOverlap = fighter.position.x + definition.stats.width * 0.42 > platform.x
        && fighter.position.x - definition.stats.width * 0.42 < platform.x + platform.width;
      const crossedTop = previousBottom <= platform.y + 6 && fighter.position.y >= platform.y;
      if (horizontalOverlap && crossedTop) {
        if (landedOn === null || platform.y < landedOn.y) landedOn = platform;
      }
    }
  }

  if (landedOn !== null) {
    const wasGrounded = fighter.grounded;
    const usedRecovery = fighter.recoveryUsed;
    const landingMove = !wasGrounded && fighter.attack !== null ? getMove(fighter, fighter.attack.moveId) : null;
    const landingSpeed = Math.abs(fighter.velocity.y);
    fighter.position.y = landedOn.y;
    fighter.velocity.y = 0;
    fighter.grounded = true;
    fighter.standingPlatformId = landedOn.id;
    fighter.jumpsRemaining = 1;
    fighter.recoveryUsed = false;
    if (usedRecovery && fighter.recoveryAttemptActive) fighter.recoveriesSucceeded += 1;
    fighter.recoveryAttemptActive = false;
    if (landingMove !== null) {
      fighter.landingLagFrames = Math.max(fighter.landingLagFrames, landingMove.landingLagFrames);
      fighter.attack = null;
    }
    if (!wasGrounded && fighter.status !== 'hurt') {
      fighter.status = 'idle';
      events.push({ type: 'land', tick: 0, actorId: fighter.id, targetId: null, position: { ...fighter.position }, value: landingSpeed, moveId: null });
    }
  } else if (fighter.grounded) {
    const platform = activePlatforms(state).find((candidate) => candidate.id === fighter.standingPlatformId);
    const stillAbove = platform !== undefined
      && fighter.position.x + definition.stats.width * 0.35 > platform.x
      && fighter.position.x - definition.stats.width * 0.35 < platform.x + platform.width;
    if (!stillAbove) {
      fighter.grounded = false;
      fighter.standingPlatformId = null;
      fighter.status = 'fall';
    }
  }
}

export function isOutOfBounds(fighter: FighterState, blastZone: Rect): boolean {
  return fighter.position.x < blastZone.x
    || fighter.position.x > blastZone.x + blastZone.width
    || fighter.position.y < blastZone.y - 120
    || fighter.position.y > blastZone.y + blastZone.height;
}

function finishMatch(state: WorldState, result: MatchResult, events: CombatEvent[]): void {
  if (state.ended) return;
  state.ended = true;
  state.result = result;
  state.projectiles = [];
  for (const fighter of state.fighters) {
    fighter.attack = null;
    fighter.velocity = { x: 0, y: 0 };
    fighter.status = result.winnerId === fighter.id ? 'victory' : 'ko';
  }
  const actorId = result.winnerId ?? 'p1';
  const winner = state.fighters.find((fighter) => fighter.id === actorId) ?? state.fighters[0];
  events.push({ type: 'match-end', tick: state.tick, actorId, targetId: null, position: { ...winner.position }, value: 0, moveId: null });
}

function respawnFighter(state: WorldState, fighter: FighterState, events: CombatEvent[]): void {
  const stage = getStage(state.options.stageId);
  const index = fighter.id === 'p1' ? 0 : 1;
  const point = stage.respawnPoints[index];
  fighter.position = { ...point };
  fighter.previousPosition = { ...point };
  fighter.velocity = { x: 0, y: 0 };
  fighter.damage = state.inSuddenDeath ? 180 : 0;
  fighter.attack = null;
  fighter.status = 'respawn';
  fighter.hitstunFrames = GAME_CONFIG.respawnDelayFrames;
  fighter.hitstopFrames = 0;
  fighter.grounded = false;
  fighter.standingPlatformId = null;
  fighter.recoveryUsed = false;
  fighter.recoveryAttemptActive = false;
  fighter.landingLagFrames = 0;
  fighter.dropThroughFrames = 0;
  fighter.dodgeRepeatWindowFrames = 0;
  fighter.jumpsRemaining = 1;
  fighter.comboHits = 0;
  fighter.comboDecayFrames = 0;
  fighter.lastHitBy = null;
  fighter.input = createInputMemory();
  events.push({ type: 'respawn', tick: state.tick, actorId: fighter.id, targetId: null, position: { ...point }, value: fighter.stocks, moveId: null });
}

function beginSuddenDeath(state: WorldState, events: CombatEvent[]): void {
  state.inSuddenDeath = true;
  state.suddenDeathFramesRemaining = GAME_CONFIG.suddenDeathFrames;
  for (const fighter of state.fighters) {
    fighter.stocks = 1;
    fighter.damage = 180;
    respawnFighter(state, fighter, events);
  }
}

function handleRingouts(state: WorldState, events: CombatEvent[]): void {
  const stage = getStage(state.options.stageId);
  const ringedOut = state.fighters.filter((fighter) => fighter.status !== 'respawn'
    && fighter.status !== 'ko'
    && fighter.status !== 'victory'
    && isOutOfBounds(fighter, stage.blastZone));
  if (ringedOut.length === 0) return;

  for (const fighter of ringedOut) {
    const opponent = state.fighters[0].id === fighter.id ? state.fighters[1] : state.fighters[0];
    events.push({ type: 'ringout', tick: state.tick, actorId: opponent.id, targetId: fighter.id, position: { ...fighter.position }, value: fighter.damage, moveId: opponent.lastMoveId });
    if (state.options.mode !== 'training') fighter.stocks -= 1;
  }

  if (state.options.mode === 'training') {
    for (const fighter of ringedOut) respawnFighter(state, fighter, events);
    return;
  }

  const eliminated = ringedOut.filter((fighter) => fighter.stocks <= 0);
  if (eliminated.length === state.fighters.length) {
    if (state.inSuddenDeath) finishMatch(state, { winnerId: null, reason: 'draw', completedAtTick: state.tick }, events);
    else beginSuddenDeath(state, events);
    return;
  }
  const loser = eliminated[0];
  if (loser !== undefined) {
    const winner = state.fighters[0].id === loser.id ? state.fighters[1] : state.fighters[0];
    finishMatch(state, { winnerId: winner.id, reason: state.inSuddenDeath ? 'sudden-death' : 'stocks', completedAtTick: state.tick }, events);
    return;
  }
  for (const fighter of ringedOut) respawnFighter(state, fighter, events);
}

function compareAtTime(state: WorldState): FighterInstanceId | null {
  const [first, second] = state.fighters;
  if (first.stocks !== second.stocks) return first.stocks > second.stocks ? first.id : second.id;
  if (Math.abs(first.damage - second.damage) > 0.01) return first.damage < second.damage ? first.id : second.id;
  return null;
}

function updateTimer(state: WorldState, events: CombatEvent[]): void {
  if (state.options.mode === 'training') return;
  if (state.inSuddenDeath) {
    state.suddenDeathFramesRemaining = Math.max(0, state.suddenDeathFramesRemaining - 1);
    if (state.suddenDeathFramesRemaining === 0) {
      const winner = compareAtTime(state);
      finishMatch(state, { winnerId: winner, reason: winner === null ? 'draw' : 'sudden-death', completedAtTick: state.tick }, events);
    }
    return;
  }
  state.timeFramesRemaining = Math.max(0, state.timeFramesRemaining - 1);
  if (state.timeFramesRemaining > 0) return;
  const winner = compareAtTime(state);
  if (winner !== null) {
    finishMatch(state, { winnerId: winner, reason: 'time', completedAtTick: state.tick }, events);
    return;
  }
  beginSuddenDeath(state, events);
}

function stampEvents(events: CombatEvent[], tick: number): void {
  for (const event of events) event.tick = tick;
}

export function stepWorld(
  state: WorldState,
  rawCommands: Readonly<Record<FighterInstanceId, InputCommand>>,
): StepResult {
  const events: CombatEvent[] = [];
  if (state.paused || state.ended) return { state, events };
  const commands = {
    p1: sanitizeCommand(rawCommands.p1),
    p2: sanitizeCommand(rawCommands.p2),
  };
  state.tick += 1;
  if (state.fighters.some((fighter) => fighter.hitstopFrames > 0)) {
    for (const fighter of state.fighters) {
      fighter.hitstopFrames = Math.max(0, fighter.hitstopFrames - 1);
      advanceInputMemory(fighter.input, commands[fighter.id]);
    }
    return { state, events };
  }

  for (const fighter of state.fighters) {
    decrementTimers(fighter);
    updateSpecialStates(fighter);
    updateControl(fighter, commands[fighter.id], events);
    updateAttack(state, fighter, events);
  }
  resolveMeleeHits(collectMeleeHits(state), commands, events);
  if (!state.fighters.some((fighter) => fighter.hitstopFrames > 0)) updateProjectiles(state, commands, events);
  const hitstopStarted = state.fighters.some((fighter) => fighter.hitstopFrames > 0);
  if (!hitstopStarted) {
    state.motionTick += 1;
    for (const fighter of state.fighters) applyPhysics(state, fighter, commands[fighter.id], events);
  }
  handleRingouts(state, events);
  if (!state.ended && !hitstopStarted) updateTimer(state, events);
  stampEvents(events, state.tick);
  return { state, events };
}

export function setPaused(state: WorldState, paused: boolean): void {
  if (!state.ended) state.paused = paused;
}

export function resetTrainingPositions(state: WorldState): void {
  const stage = getStage(state.options.stageId);
  state.projectiles = [];
  for (const fighter of state.fighters) {
    const index = fighter.id === 'p1' ? 0 : 1;
    const fresh = createSpawnedFighter(fighter.id, fighter.definitionId, stage, index, state.motionTick, state.options.hazards);
    const retained = {
      damage: fighter.damage,
      stocks: fighter.stocks,
      moveCooldowns: { ...fighter.moveCooldowns },
      totalDamageDealt: fighter.totalDamageDealt,
      hitsLanded: fighter.hitsLanded,
      recoveriesAttempted: fighter.recoveriesAttempted,
      recoveriesSucceeded: fighter.recoveriesSucceeded,
    };
    Object.assign(fighter, fresh);
    Object.assign(fighter, retained);
  }
  state.paused = false;
  state.ended = false;
  state.result = null;
}

export function resetTrainingDamage(state: WorldState): void {
  for (const fighter of state.fighters) fighter.damage = 0;
}

export function forceMatchEnd(state: WorldState, winnerId: FighterInstanceId): CombatEvent[] {
  const events: CombatEvent[] = [];
  finishMatch(state, { winnerId, reason: 'stocks', completedAtTick: state.tick }, events);
  stampEvents(events, state.tick);
  return events;
}

export function emptyCommands(): Record<FighterInstanceId, InputCommand> {
  return { p1: cloneCommand(EMPTY_COMMAND), p2: cloneCommand(EMPTY_COMMAND) };
}
