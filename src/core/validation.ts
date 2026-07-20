import type { FighterDefinition, MoveDefinition, StageDefinition } from './types';

function assertFinitePositive(value: number, path: string, allowZero = false): void {
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) throw new Error(`Invalid numeric value at ${path}: ${String(value)}`);
}

function validateMove(move: MoveDefinition, path: string): void {
  if (!move.id || !move.displayName.ko || !move.displayName.en) throw new Error(`Invalid move identity at ${path}.`);
  assertFinitePositive(move.startupFrames, `${path}.startupFrames`, true);
  assertFinitePositive(move.activeFrames, `${path}.activeFrames`);
  assertFinitePositive(move.recoveryFrames, `${path}.recoveryFrames`, true);
  assertFinitePositive(move.damage, `${path}.damage`, true);
  assertFinitePositive(move.range, `${path}.range`);
  assertFinitePositive(move.hitbox.width, `${path}.hitbox.width`);
  assertFinitePositive(move.hitbox.height, `${path}.hitbox.height`);
  if (move.angle < -90 || move.angle > 270) throw new Error(`Invalid launch angle at ${path}.angle.`);
  if (move.availability.length === 0) throw new Error(`Move ${path} has no usable state.`);
  if (move.projectile !== null) {
    assertFinitePositive(move.projectile.speed, `${path}.projectile.speed`);
    assertFinitePositive(move.projectile.maxActive, `${path}.projectile.maxActive`);
  }
}

export function validateFighters(definitions: readonly FighterDefinition[]): void {
  const ids = new Set<string>();
  for (const fighter of definitions) {
    if (ids.has(fighter.id)) throw new Error(`Duplicate fighter id: ${fighter.id}`);
    ids.add(fighter.id);
    assertFinitePositive(fighter.stats.weight, `${fighter.id}.stats.weight`);
    assertFinitePositive(fighter.stats.runSpeed, `${fighter.id}.stats.runSpeed`);
    const moves = Object.values(fighter.moves);
    if (moves.length < 9) throw new Error(`${fighter.id} requires at least nine moves.`);
    const moveIds = new Set<string>();
    for (const move of moves) {
      if (moveIds.has(move.id)) throw new Error(`Duplicate move id: ${move.id}`);
      moveIds.add(move.id);
      validateMove(move, `${fighter.id}.moves.${move.id}`);
    }
  }
}

export function validateStages(stages: readonly StageDefinition[]): void {
  for (const stage of stages) {
    if (stage.platforms.length === 0) throw new Error(`${stage.id} has no platforms.`);
    assertFinitePositive(stage.blastZone.width, `${stage.id}.blastZone.width`);
    assertFinitePositive(stage.blastZone.height, `${stage.id}.blastZone.height`);
    for (const platform of stage.platforms) {
      assertFinitePositive(platform.width, `${stage.id}.${platform.id}.width`);
      assertFinitePositive(platform.height, `${stage.id}.${platform.id}.height`);
      if (platform.moving !== null) {
        assertFinitePositive(platform.moving.periodFrames, `${stage.id}.${platform.id}.periodFrames`);
      }
    }
  }
}
