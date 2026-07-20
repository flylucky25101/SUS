import type { FighterState } from '../core/types';

export type SpriteAnimationName = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death';

export interface SpriteAnimationDefinition {
  readonly row: number;
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly holdLastFrame?: boolean;
}

export type SpriteAnimationMap = Readonly<Record<SpriteAnimationName, SpriteAnimationDefinition>>;

export const PLAYER_ANIMATIONS: SpriteAnimationMap = Object.freeze({
  idle: { row: 0, frames: 4, fps: 5, loop: true },
  walk: { row: 1, frames: 8, fps: 10, loop: true },
  run: { row: 2, frames: 8, fps: 14, loop: true },
  attack: { row: 3, frames: 6, fps: 12, loop: false },
  hit: { row: 4, frames: 3, fps: 10, loop: false },
  death: { row: 5, frames: 6, fps: 8, loop: false, holdLastFrame: true },
});

const ANIMATION_PRIORITY: Readonly<Record<SpriteAnimationName, number>> = Object.freeze({
  idle: 0,
  walk: 1,
  run: 2,
  attack: 3,
  hit: 4,
  death: 5,
});

const WALK_SPEED_THRESHOLD = 0.15;
const RUN_SPEED_RATIO = 0.68;

export interface SpriteAnimationSnapshot {
  readonly name: SpriteAnimationName;
  readonly frame: number;
  readonly finished: boolean;
}

export class SpriteAnimationTimeline {
  private readonly animations: SpriteAnimationMap;
  private animationName: SpriteAnimationName;
  private elapsedMs = 0;
  private frameIndex = 0;
  private animationFinished = false;

  constructor(animations: SpriteAnimationMap, initialAnimation: SpriteAnimationName = 'idle') {
    this.animations = animations;
    this.animationName = initialAnimation;
  }

  setAnimation(name: SpriteAnimationName, restart = false): boolean {
    if (name === this.animationName && !restart) return true;
    if (name === this.animationName && restart) {
      this.elapsedMs = 0;
      this.frameIndex = 0;
      this.animationFinished = false;
      return true;
    }
    const current = this.animations[this.animationName];
    const currentIsLocked = current.holdLastFrame === true || (!current.loop && !this.animationFinished);
    if (currentIsLocked && ANIMATION_PRIORITY[name] <= ANIMATION_PRIORITY[this.animationName]) return false;

    this.animationName = name;
    this.elapsedMs = 0;
    this.frameIndex = 0;
    this.animationFinished = false;
    return true;
  }

  update(deltaMs: number): void {
    const definition = this.animations[this.animationName];
    const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    this.elapsedMs += safeDelta;
    const frameDuration = 1000 / definition.fps;

    if (definition.loop) {
      this.frameIndex = Math.floor(this.elapsedMs / frameDuration) % definition.frames;
      return;
    }

    const animationDuration = definition.frames * frameDuration;
    if (this.elapsedMs >= animationDuration) {
      this.animationFinished = true;
      this.frameIndex = definition.frames - 1;
      return;
    }
    this.frameIndex = Math.min(definition.frames - 1, Math.floor(this.elapsedMs / frameDuration));
  }

  snapshot(): SpriteAnimationSnapshot {
    return {
      name: this.animationName,
      frame: this.frameIndex,
      finished: this.animationFinished,
    };
  }
}

export function selectPlayerAnimation(fighter: FighterState, runSpeed: number): SpriteAnimationName {
  if (fighter.status === 'ko') return 'death';
  if (fighter.status === 'hurt') return 'hit';
  if (fighter.status === 'attack' || fighter.status === 'charge') return 'attack';

  const horizontalSpeed = Math.abs(fighter.velocity.x);
  if (horizontalSpeed >= runSpeed * RUN_SPEED_RATIO) return 'run';
  if (fighter.status === 'run' || horizontalSpeed > WALK_SPEED_THRESHOLD) return 'walk';
  return 'idle';
}
