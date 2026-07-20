import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/core/combat';
import { getFighter } from '../../src/data/fighters';
import {
  PLAYER_ANIMATIONS,
  SpriteAnimationTimeline,
  selectPlayerAnimation,
} from '../../src/render/sprite-animation';

describe('SpriteAnimationTimeline', () => {
  it('advances looping animation frames from delta time at the configured fps', () => {
    const timeline = new SpriteAnimationTimeline(PLAYER_ANIMATIONS);
    timeline.update(199);
    expect(timeline.snapshot()).toMatchObject({ name: 'idle', frame: 0, finished: false });
    timeline.update(1);
    expect(timeline.snapshot()).toMatchObject({ frame: 1 });
    timeline.update(600);
    expect(timeline.snapshot()).toMatchObject({ frame: 0 });
  });

  it('does not reset when the same movement animation is requested repeatedly', () => {
    const timeline = new SpriteAnimationTimeline(PLAYER_ANIMATIONS);
    timeline.setAnimation('walk');
    timeline.update(250);
    expect(timeline.snapshot().frame).toBe(2);
    timeline.setAnimation('walk');
    expect(timeline.snapshot().frame).toBe(2);
  });

  it('locks attack until completion but permits a higher-priority hit reaction', () => {
    const timeline = new SpriteAnimationTimeline(PLAYER_ANIMATIONS);
    timeline.setAnimation('attack');
    timeline.update(100);
    expect(timeline.setAnimation('idle')).toBe(false);
    expect(timeline.setAnimation('hit')).toBe(true);
    expect(timeline.snapshot()).toMatchObject({ name: 'hit', frame: 0 });
    expect(timeline.setAnimation('attack')).toBe(false);
    timeline.update(300);
    expect(timeline.snapshot()).toMatchObject({ name: 'hit', frame: 2, finished: true });
    expect(timeline.setAnimation('idle')).toBe(true);
  });

  it('holds the final death frame and never accepts a lower-priority state', () => {
    const timeline = new SpriteAnimationTimeline(PLAYER_ANIMATIONS);
    timeline.setAnimation('death');
    timeline.update(750);
    expect(timeline.snapshot()).toEqual({ name: 'death', frame: 5, finished: true });
    expect(timeline.setAnimation('idle')).toBe(false);
    timeline.update(10_000);
    expect(timeline.snapshot()).toEqual({ name: 'death', frame: 5, finished: true });
  });

  it('produces the same frame for the same elapsed time at different render rates', () => {
    const singleStep = new SpriteAnimationTimeline(PLAYER_ANIMATIONS, 'run');
    const manySteps = new SpriteAnimationTimeline(PLAYER_ANIMATIONS, 'run');
    singleStep.update(997);
    for (let index = 0; index < 59; index += 1) manySteps.update(997 / 59);
    expect(manySteps.snapshot()).toEqual(singleStep.snapshot());
  });
});

describe('selectPlayerAnimation', () => {
  it('maps existing combat state with death > hit > attack > run > walk > idle priority', () => {
    const world = createWorld({
      mode: 'quick',
      fighterOne: 'kade',
      fighterTwo: 'mira',
      stageId: 'vector-spire',
      difficulty: 'normal',
      hazards: true,
      seed: 42,
    });
    const fighter = world.fighters[0];
    const runSpeed = getFighter(fighter.definitionId).stats.runSpeed;

    fighter.status = 'idle';
    fighter.velocity.x = 0;
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('idle');
    fighter.status = 'run';
    fighter.velocity.x = runSpeed * 0.3;
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('walk');
    fighter.velocity.x = runSpeed;
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('run');
    fighter.status = 'attack';
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('attack');
    fighter.status = 'hurt';
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('hit');
    fighter.status = 'ko';
    expect(selectPlayerAnimation(fighter, runSpeed)).toBe('death');
  });
});
