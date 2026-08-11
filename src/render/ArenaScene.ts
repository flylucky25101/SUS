import Phaser from 'phaser';
import { AiController, createAiControllers } from '../ai/controller';
import type { AudioSystem } from '../audio/audio';
import { forceMatchEnd, resetTrainingDamage, resetTrainingPositions, setPaused, stepWorld, createWorld, attackHitbox, fighterHurtbox } from '../core/combat';
import { GAME_CONFIG } from '../core/config';
import { clamp } from '../core/math';
import type { CombatEvent, FighterInstanceId, FighterState, MatchOptions, WorldState } from '../core/types';
import type { InputManager } from '../input/input-manager';
import { getFighter } from '../data/fighters';
import { getStage, platformAtTick } from '../data/stages';
import type { GameSettings } from '../ui/settings';
import { SpriteAnimator, type SpriteAnimatorSnapshot } from './SpriteAnimator';
import { PLAYER_ANIMATIONS, selectPlayerAnimation, type SpriteAnimationName } from './sprite-animation';

export interface ArenaCallbacks {
  onReady: () => void;
  onState: (state: WorldState, fps: number, particles: number) => void;
  onPauseRequest: () => void;
  onResult: (state: WorldState) => void;
  onCombatEvent: (event: CombatEvent) => void;
  onCountdown: (value: number) => void;
}

export interface ArenaLaunch {
  options: MatchOptions;
  input: InputManager;
  audio: AudioSystem;
  getSettings: () => GameSettings;
  callbacks: ArenaCallbacks;
}

interface EffectParticle {
  active: boolean;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  maximumLife: number;
  color: number;
  size: number;
  kind: 'spark' | 'trail' | 'dust' | 'ring';
}

interface ImpactBurst {
  x: number;
  y: number;
  direction: -1 | 1;
  color: number;
  power: number;
  life: number;
  maximumLife: number;
  holdFrames: number;
  strong: boolean;
}

type ProjectileVisualKind = 'lance' | 'comet' | 'gale' | 'singularity' | 'pulse';

interface ProjectileVisualStyle {
  readonly kind: ProjectileVisualKind;
  readonly color: number;
  readonly accent: number;
}

const PARTICLE_CAPACITY = 120;
const IMPACT_CAPACITY = 12;
const FIGHTER_SPRITE_URLS: Readonly<Record<FighterState['definitionId'], string>> = Object.freeze({
  kade: './assets/fighters/kade-spritesheet.png',
  mira: './assets/fighters/mira-spritesheet.png',
  bram: './assets/fighters/bram-spritesheet.png',
  suri: './assets/fighters/suri-spritesheet.png',
  juno: './assets/fighters/juno-spritesheet.png',
  orin: './assets/fighters/orin-spritesheet.png',
});
const STAGE_BACKGROUND_URLS: Readonly<Record<MatchOptions['stageId'], string>> = Object.freeze({
  'vector-spire': './assets/stages/vector-spire-bg.webp',
  'drift-garden': './assets/stages/drift-garden-bg.webp',
});
const PLAYER_SPRITE_FRAME_SIZE = 64;
const PLAYER_SPRITE_DISPLAY_SIZE = 140;
const PLAYER_SPRITE_REFERENCE_HEIGHT = 86;
const PLAYER_SPRITE_FOOT_BASELINE = 60;
const COMPACT_FIGHTER_VISUAL_SCALE = 1.9;
const COMPACT_VIEWPORT_MAX_WIDTH = 960;
const COMPACT_VIEWPORT_MAX_HEIGHT = 520;
const CAMERA_COVER_OVERSCAN = 1.03;
const STAGE_BACKGROUND_OVERSCAN = 1.5;

function projectileVisualStyle(moveId: string, fallbackColor: number): ProjectileVisualStyle {
  if (moveId.startsWith('kade.')) return { kind: 'lance', color: 0x35d9ff, accent: 0xd9f8ff };
  if (moveId.startsWith('suri.')) return { kind: 'comet', color: 0xa66bff, accent: 0xf0ddff };
  if (moveId.startsWith('juno.')) return { kind: 'gale', color: 0x36e6a0, accent: 0xd9fff0 };
  if (moveId.startsWith('orin.')) return { kind: 'singularity', color: 0xff4d5f, accent: 0xffd8dc };
  return { kind: 'pulse', color: fallbackColor, accent: 0xffffff };
}

interface FighterSpriteTracking {
  animation: SpriteAnimationName;
  status: FighterState['status'];
  attackFrame: number;
  attackMoveId: string | null;
  hitstunFrames: number;
}

function createSpriteTracking(): FighterSpriteTracking {
  return { animation: 'idle', status: 'idle', attackFrame: -1, attackMoveId: null, hitstunFrames: 0 };
}

export class ArenaScene extends Phaser.Scene {
  private readonly launch: ArenaLaunch;
  private world: WorldState;
  private ai: Record<FighterInstanceId, AiController>;
  private accumulator = 0;
  private simulationSpeed = 1;
  private previousPauseInput = false;
  private resultSent = false;
  private countdownFrames = 150;
  private lastCountdownValue = -1;
  private backgroundGraphics!: Phaser.GameObjects.Graphics;
  private stageGraphics!: Phaser.GameObjects.Graphics;
  private lightingGraphics!: Phaser.GameObjects.Graphics;
  private projectileGlowGraphics!: Phaser.GameObjects.Graphics;
  private projectileGraphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private fighterGraphics!: Record<FighterInstanceId, Phaser.GameObjects.Graphics>;
  private particles: EffectParticle[] = [];
  private impactBursts: ImpactBurst[] = [];
  private cameraZoomPunch = 0;
  private cameraImpactX = 0;
  private cameraImpactY = 0;
  private lastHudTick = -1;
  private fighterSpriteAnimators: Partial<Record<FighterInstanceId, SpriteAnimator>> = {};
  private fighterSpriteTracking: Record<FighterInstanceId, FighterSpriteTracking> = {
    p1: createSpriteTracking(),
    p2: createSpriteTracking(),
  };
  private stageBackgroundImage: Phaser.GameObjects.Image | null = null;
  private stageBackgroundTextureKey: string | null = null;
  private sceneAssetsDestroyed = false;

  constructor(launch: ArenaLaunch) {
    super({ key: 'ArenaScene' });
    this.launch = launch;
    this.world = createWorld(launch.options);
    this.ai = createAiControllers(launch.options.seed, launch.options.difficulty);
  }

  create(): void {
    this.backgroundGraphics = this.add.graphics().setDepth(-20);
    this.stageGraphics = this.add.graphics().setDepth(-5);
    this.lightingGraphics = this.add.graphics().setDepth(2).setBlendMode(Phaser.BlendModes.ADD);
    this.projectileGlowGraphics = this.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    this.projectileGraphics = this.add.graphics().setDepth(6);
    this.effectGraphics = this.add.graphics().setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    this.debugGraphics = this.add.graphics().setDepth(20);
    this.fighterGraphics = {
      p1: this.add.graphics().setDepth(4),
      p2: this.add.graphics().setDepth(4),
    };
    for (const fighter of this.world.fighters) {
      this.fighterSpriteAnimators[fighter.id] = new SpriteAnimator(
        this,
        FIGHTER_SPRITE_URLS[fighter.definitionId],
        PLAYER_SPRITE_FRAME_SIZE,
        PLAYER_SPRITE_FRAME_SIZE,
        PLAYER_ANIMATIONS,
      );
    }
    this.loadStageBackground();
    this.particles = Array.from({ length: PARTICLE_CAPACITY }, () => ({
      active: false,
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      life: 0,
      maximumLife: 1,
      color: 0xffffff,
      size: 2,
      kind: 'spark',
    }));
    this.drawBackground();
    this.cameras.main.setBackgroundColor('#080b12');
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.sceneAssetsDestroyed = true;
      for (const animator of Object.values(this.fighterSpriteAnimators)) animator?.destroy();
      this.fighterSpriteAnimators = {};
      this.stageBackgroundImage?.destroy();
      this.stageBackgroundImage = null;
      if (this.stageBackgroundTextureKey !== null && this.textures.exists(this.stageBackgroundTextureKey)) {
        this.textures.remove(this.stageBackgroundTextureKey);
      }
      this.stageBackgroundTextureKey = null;
    });
    this.launch.callbacks.onReady();
  }

  update(_time: number, rawDelta: number): void {
    const command = this.launch.input.getCommand();
    if (command.pause && !this.previousPauseInput) this.launch.callbacks.onPauseRequest();
    this.previousPauseInput = command.pause;
    const delta = Math.min(GAME_CONFIG.maxDeltaMs, rawDelta) * this.simulationSpeed;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= GAME_CONFIG.fixedDeltaMs && steps < GAME_CONFIG.maxCatchUpSteps * Math.max(1, this.simulationSpeed)) {
      this.accumulator -= GAME_CONFIG.fixedDeltaMs;
      steps += 1;
      if (!this.world.paused && !this.world.ended) {
        if (this.countdownFrames > 0) {
          this.countdownFrames -= 1;
          const value = this.countdownFrames <= 0 ? 0 : Math.ceil(this.countdownFrames / 60);
          if (value !== this.lastCountdownValue) {
            this.lastCountdownValue = value;
            this.launch.callbacks.onCountdown(value);
          }
          if (this.countdownFrames === 120 || this.countdownFrames === 60 || this.countdownFrames === 1) this.launch.audio.play('countdown');
        } else {
          const p1 = this.world.options.mode === 'debug' ? this.ai.p1.next(this.world, 'p1') : command;
          const p2 = this.ai.p2.next(this.world, 'p2');
          const result = stepWorld(this.world, { p1, p2 });
          this.world = result.state;
          for (const event of result.events) this.handleCombatEvent(event);
        }
      }
      this.updateParticles();
    }
    if (steps >= GAME_CONFIG.maxCatchUpSteps * Math.max(1, this.simulationSpeed)) this.accumulator = 0;
    this.updateFighterSprites(rawDelta);
    this.renderWorld();
    this.updateCamera(rawDelta);
    if (this.world.tick !== this.lastHudTick && (this.world.tick % 2 === 0 || this.world.ended)) {
      this.lastHudTick = this.world.tick;
      this.launch.callbacks.onState(this.world, this.game.loop.actualFps, this.activeParticleCount());
    }
    if (this.world.ended && !this.resultSent) {
      this.resultSent = true;
      this.launch.callbacks.onResult(this.world);
    }
  }

  setPaused(paused: boolean): void {
    setPaused(this.world, paused);
    if (!paused) this.previousPauseInput = true;
  }

  setSimulationSpeed(speed: number): void {
    this.simulationSpeed = clamp(speed, 0.5, 8);
  }

  setTrainingBehavior(behavior: WorldState['training']['behavior']): void {
    this.world.training.behavior = behavior;
  }

  setTrainingOverlay(key: 'showHitboxes' | 'showFrameData' | 'showInputs', value: boolean): void {
    this.world.training[key] = value;
  }

  resetDamage(): void {
    resetTrainingDamage(this.world);
  }

  resetPositions(): void {
    resetTrainingPositions(this.world);
    this.ai = createAiControllers(this.world.options.seed, this.world.options.difficulty);
  }

  forceResult(winnerId: FighterInstanceId): void {
    for (const event of forceMatchEnd(this.world, winnerId)) this.handleCombatEvent(event);
  }

  getWorld(): WorldState {
    return this.world;
  }

  getPlayerSpriteSnapshot(): SpriteAnimatorSnapshot | null {
    return this.fighterSpriteAnimators.p1?.snapshot() ?? null;
  }

  getFighterSpriteSnapshot(id: FighterInstanceId): SpriteAnimatorSnapshot | null {
    return this.fighterSpriteAnimators[id]?.snapshot() ?? null;
  }

  getFighterVisualScale(): number {
    const viewportWidth = Math.max(window.innerWidth, window.innerHeight);
    const viewportHeight = Math.min(window.innerWidth, window.innerHeight);
    return viewportWidth <= COMPACT_VIEWPORT_MAX_WIDTH && viewportHeight <= COMPACT_VIEWPORT_MAX_HEIGHT
      ? COMPACT_FIGHTER_VISUAL_SCALE
      : 1;
  }

  isStageBackgroundReady(): boolean {
    return this.stageBackgroundImage !== null;
  }

  private handleResize(): void {
    this.drawBackground();
  }

  private drawBackground(): void {
    if (this.backgroundGraphics === undefined) return;
    const graphics = this.backgroundGraphics;
    graphics.clear();
    graphics.fillStyle(0x080b12, 1);
    graphics.fillRect(-1200, -900, 3680, 2520);
    const stage = getStage(this.world.options.stageId);
    const accent = stage.theme === 'spire' ? 0x153651 : 0x2b2140;
    graphics.fillStyle(accent, 0.3);
    graphics.fillCircle(640, 310, 410);
    graphics.lineStyle(1, stage.theme === 'spire' ? 0x1b6080 : 0x533a78, 0.38);
    for (let x = -200; x <= 1480; x += 80) graphics.lineBetween(x, 50, x - 220, 760);
    for (let y = 80; y <= 720; y += 64) graphics.lineBetween(-200, y, 1480, y);
    graphics.lineStyle(2, stage.theme === 'spire' ? 0x27b9e5 : 0x9a63e8, 0.16);
    for (let radius = 180; radius <= 500; radius += 80) graphics.strokeCircle(640, 310, radius);
    if (stage.theme === 'garden') {
      for (let index = 0; index < 18; index += 1) {
        const x = 130 + ((index * 167) % 1040);
        const y = 120 + ((index * 83) % 390);
        graphics.fillStyle(index % 2 === 0 ? 0x45e0b2 : 0xb66aff, 0.15);
        graphics.fillEllipse(x, y, 30 + (index % 4) * 9, 10 + (index % 3) * 5);
      }
    }
  }

  private renderWorld(): void {
    this.drawStage();
    this.drawLighting();
    for (const fighter of this.world.fighters) this.drawFighter(fighter, this.fighterGraphics[fighter.id]);
    this.drawProjectiles();
    this.drawParticles();
    this.drawDebug();
  }

  private updateFighterSprites(rawDelta: number): void {
    for (const fighter of this.world.fighters) this.updateFighterSprite(fighter, rawDelta);
  }

  private updateFighterSprite(fighter: FighterState, rawDelta: number): void {
    const animator = this.fighterSpriteAnimators[fighter.id];
    if (animator === undefined) return;
    const definition = getFighter(fighter.definitionId);
    const tracking = this.fighterSpriteTracking[fighter.id];
    const animation = selectPlayerAnimation(fighter, definition.stats.runSpeed);
    const attackFrame = fighter.attack?.frame ?? -1;
    const attackMoveId = fighter.attack?.moveId ?? null;
    const attackRestarted = animation === 'attack' && (
      tracking.animation !== 'attack'
      || (fighter.status === 'attack' && tracking.status !== 'attack')
      || attackMoveId !== tracking.attackMoveId
      || (attackFrame >= 0 && attackFrame < tracking.attackFrame)
    );
    const hitRestarted = animation === 'hit' && (
      tracking.animation !== 'hit'
      || fighter.hitstunFrames > tracking.hitstunFrames
    );
    animator.setAnimation(animation, attackRestarted || hitRestarted);
    animator.update(Math.min(GAME_CONFIG.maxDeltaMs, Math.max(0, rawDelta)));
    tracking.animation = animation;
    tracking.status = fighter.status;
    tracking.attackFrame = attackFrame;
    tracking.attackMoveId = attackMoveId;
    tracking.hitstunFrames = fighter.hitstunFrames;
  }

  private loadStageBackground(): void {
    const stageId = this.world.options.stageId;
    const textureKey = `stage-background-${stageId}`;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (this.sceneAssetsDestroyed) return;
      const texture = this.textures.addImage(textureKey, image);
      if (texture === null) return;
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.stageBackgroundTextureKey = textureKey;
      this.stageBackgroundImage = this.add.image(GAME_CONFIG.worldWidth / 2, GAME_CONFIG.worldHeight / 2, textureKey)
        .setDisplaySize(
          GAME_CONFIG.worldWidth * STAGE_BACKGROUND_OVERSCAN,
          GAME_CONFIG.worldHeight * STAGE_BACKGROUND_OVERSCAN,
        )
        .setDepth(-19)
        .setAlpha(0.76);
    };
    image.onerror = () => undefined;
    image.src = STAGE_BACKGROUND_URLS[stageId];
  }

  private drawStage(): void {
    const graphics = this.stageGraphics;
    const stage = getStage(this.world.options.stageId);
    graphics.clear();
    for (const source of stage.platforms) {
      const platform = platformAtTick(source, this.world.motionTick, this.world.options.hazards);
      const primary = stage.theme === 'spire' ? 0x1dd4ef : 0x73e2b8;
      const surface = stage.theme === 'spire' ? 0x202d3d : 0x293746;
      const side = stage.theme === 'spire' ? 0x101925 : 0x14231f;
      graphics.fillStyle(0x000000, 0.34);
      graphics.fillRoundedRect(platform.x + 7, platform.y + 13, platform.width, platform.height + 15, platform.id === 'main' ? 12 : 7);
      graphics.fillStyle(primary, 0.12);
      graphics.fillRoundedRect(platform.x - 8, platform.y - 8, platform.width + 16, platform.height + 20, 12);
      graphics.fillStyle(side, 0.98);
      graphics.fillRoundedRect(platform.x, platform.y + 8, platform.width, platform.height + 10, platform.id === 'main' ? 12 : 7);
      graphics.fillStyle(surface, 1);
      graphics.fillRoundedRect(platform.x, platform.y, platform.width, platform.height, platform.id === 'main' ? 12 : 7);
      graphics.fillStyle(0xffffff, 0.055);
      graphics.fillRoundedRect(platform.x + 7, platform.y + 5, platform.width - 14, Math.max(3, platform.height * 0.22), 3);
      graphics.fillStyle(primary, 0.9);
      graphics.fillRoundedRect(platform.x + 4, platform.y, platform.width - 8, 4, 2);
      graphics.lineStyle(2, 0x000000, 0.34);
      graphics.lineBetween(platform.x + 9, platform.y + platform.height, platform.x + platform.width - 9, platform.y + platform.height);
      graphics.lineStyle(1, primary, 0.28);
      for (let x = platform.x + 24; x < platform.x + platform.width - 12; x += 52) {
        graphics.lineBetween(x, platform.y + 9, x + 17, platform.y + platform.height - 7);
      }
      if (source.moving !== null && this.world.options.hazards) {
        const warningAlpha = 0.22 + Math.abs(Math.sin(this.world.motionTick / 24)) * 0.25;
        graphics.lineStyle(2, 0xffd469, warningAlpha);
        graphics.strokeRoundedRect(platform.x - 5, platform.y - 5, platform.width + 10, platform.height + 10, 9);
      }
    }
    graphics.fillStyle(stage.theme === 'spire' ? 0x0d2e42 : 0x183a35, 0.85);
    graphics.fillTriangle(300, 554, 430, 554, 340, 670);
    graphics.fillTriangle(980, 554, 850, 554, 940, 670);
    graphics.lineStyle(2, stage.theme === 'spire' ? 0x23b7e2 : 0x65d3a9, 0.22);
    graphics.lineBetween(340, 670, 640, 620);
    graphics.lineBetween(940, 670, 640, 620);
  }

  private drawLighting(): void {
    const graphics = this.lightingGraphics;
    const stage = getStage(this.world.options.stageId);
    const stageColor = stage.theme === 'spire' ? 0x35d9ff : 0x9d75ff;
    graphics.clear();
    graphics.fillStyle(stageColor, 0.025);
    graphics.fillTriangle(290, 40, 530, 610, 70, 610);
    graphics.fillTriangle(990, 40, 1210, 610, 750, 610);
    graphics.fillStyle(stageColor, 0.045);
    graphics.fillEllipse(640, 576, 760, 72);

    for (const fighter of this.world.fighters) {
      const definition = getFighter(fighter.definitionId);
      const centerY = fighter.position.y - definition.stats.height * 0.48;
      const pulse = 0.018 + Math.abs(Math.sin(this.world.motionTick * 0.045 + (fighter.id === 'p1' ? 0 : 1.7))) * 0.015;
      graphics.fillStyle(definition.color, pulse);
      graphics.fillEllipse(fighter.position.x, centerY, definition.stats.width * 2.7, definition.stats.height * 1.65);
      if (fighter.status === 'attack' || fighter.status === 'charge') {
        graphics.lineStyle(2, definition.accent, 0.16);
        graphics.strokeCircle(fighter.position.x, centerY, definition.stats.height * 0.72);
      }
    }
  }

  private fighterShadowY(fighter: FighterState): number {
    const definition = getFighter(fighter.definitionId);
    const platforms = getStage(this.world.options.stageId).platforms
      .map((platform) => platformAtTick(platform, this.world.motionTick, this.world.options.hazards))
      .filter((platform) => (
        platform.y >= fighter.position.y - 5
        && fighter.position.x + definition.stats.width * 0.35 >= platform.x
        && fighter.position.x - definition.stats.width * 0.35 <= platform.x + platform.width
      ))
      .sort((first, second) => first.y - second.y);
    return platforms[0]?.y ?? fighter.position.y + 6;
  }

  private drawFighter(fighter: FighterState, graphics: Phaser.GameObjects.Graphics): void {
    const definition = getFighter(fighter.definitionId);
    const attackFrame = fighter.attack?.frame ?? 0;
    const movementPhase = this.world.motionTick * 0.16 + (fighter.id === 'p1' ? 0 : 1.7);
    const bob = fighter.status === 'idle' ? Math.sin(movementPhase) * 2.4 : 0;
    const runSwing = fighter.status === 'run' ? Math.sin(movementPhase * 1.8) * 12 : 0;
    const hurtTilt = fighter.status === 'hurt' ? clamp(fighter.velocity.x * -1.6, -18, 18) : 0;
    const attackSwing = fighter.status === 'attack' ? Math.sin(Math.min(1, attackFrame / 10) * Math.PI) * 34 : 0;
    const x = fighter.position.x;
    const feet = fighter.position.y + bob;
    const facing = fighter.facing;
    const alpha = fighter.status === 'respawn' ? 0.35 + Math.abs(Math.sin(this.world.tick / 6)) * 0.55 : 1;
    // This scale affects only the artwork. Physics coordinates, hurtboxes and hitboxes
    // continue to use the unchanged fighter definition dimensions.
    const displaySize = PLAYER_SPRITE_DISPLAY_SIZE
      * (definition.stats.height / PLAYER_SPRITE_REFERENCE_HEIGHT)
      * this.getFighterVisualScale();
    const footOffset = (PLAYER_SPRITE_FRAME_SIZE - PLAYER_SPRITE_FOOT_BASELINE) * (displaySize / PLAYER_SPRITE_FRAME_SIZE);
    graphics.clear();
    graphics.setAlpha(alpha);
    const shadowY = this.fighterShadowY(fighter);
    const altitude = clamp(shadowY - fighter.position.y, 0, 260);
    const shadowScale = clamp(1 - altitude / 430, 0.48, 1);
    const shadowAlpha = clamp(0.38 - altitude / 920, 0.14, 0.38);
    graphics.fillStyle(0x000000, shadowAlpha * 0.34);
    graphics.fillEllipse(x + facing * 6, shadowY + 5, definition.stats.width * 2.25 * shadowScale, 25 * shadowScale);
    graphics.fillStyle(0x000000, shadowAlpha);
    graphics.fillEllipse(x + facing * 3, shadowY + 2, definition.stats.width * 1.5 * shadowScale, 12 * shadowScale);
    if (altitude < 24) {
      graphics.fillStyle(definition.color, 0.11);
      graphics.fillEllipse(x, shadowY, definition.stats.width * 1.05, 5);
    }
    const glowStrength = fighter.status === 'attack' || fighter.status === 'charge' ? 0.16 : 0.075;
    graphics.fillStyle(definition.color, glowStrength);
    graphics.fillEllipse(
      x,
      feet - definition.stats.height * 0.5,
      definition.stats.width * 1.7,
      definition.stats.height * 1.08,
    );
    graphics.lineStyle(Math.max(2, definition.stats.width * 0.055), definition.accent, fighter.status === 'hurt' ? 0.2 : 0.09);
    graphics.lineBetween(
      x - definition.stats.width * 0.48,
      feet - definition.stats.height * 0.9,
      x - definition.stats.width * 0.24,
      feet - definition.stats.height * 0.18,
    );
    const spriteDrawn = this.fighterSpriteAnimators[fighter.id]?.draw({
      x,
      y: fighter.position.y + footOffset,
      width: displaySize,
      height: displaySize,
      flipX: facing < 0,
      alpha,
      depth: 4,
    }) === true;

    if (fighter.invulnerabilityFrames > 0) {
      graphics.lineStyle(3, 0xffffff, 0.3 + Math.abs(Math.sin(this.world.tick / 4)) * 0.45);
      graphics.strokeCircle(x, feet - definition.stats.height * 0.52, definition.stats.width * 0.78);
    }
    if (fighter.armorFrames > 0) {
      graphics.lineStyle(5, 0xffd06b, 0.7);
      graphics.strokeRoundedRect(x - definition.stats.width * 0.62, feet - definition.stats.height - 6, definition.stats.width * 1.24, definition.stats.height + 10, 18);
    }

    if (!spriteDrawn) {
      graphics.lineStyle(7, 0x05070b, 0.9);
      graphics.fillStyle(definition.color, 1);
      if (fighter.definitionId === 'kade') this.drawKade(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
      else if (fighter.definitionId === 'mira') this.drawMira(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
      else if (fighter.definitionId === 'bram') this.drawBram(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
      else if (fighter.definitionId === 'suri') this.drawSuri(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
      else if (fighter.definitionId === 'juno') this.drawJuno(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
      else this.drawOrin(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
    }
    graphics.setAlpha(1);
  }

  private drawKade(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.15;
    graphics.lineStyle(8, 0x091017, 1);
    graphics.lineBetween(centerX - 10, feet - 28, centerX - 14 + run * 0.55, feet);
    graphics.lineBetween(centerX + 10, feet - 28, centerX + 14 - run * 0.55, feet);
    graphics.fillStyle(0x35d9ff, 1);
    graphics.fillTriangle(centerX - 24, feet - 68, centerX + 22, feet - 68, centerX, feet - 24);
    graphics.fillStyle(0x143e54, 1);
    graphics.fillRoundedRect(centerX - 18, feet - 68, 36, 42, 8);
    graphics.fillStyle(accent, 1);
    graphics.fillTriangle(centerX - 15, feet - 86, centerX + 15, feet - 86, centerX, feet - 101);
    graphics.fillStyle(0x0b2636, 1);
    graphics.fillRect(centerX - 12, feet - 88, 24, 16);
    graphics.lineStyle(5, 0x35d9ff, 1);
    graphics.lineBetween(centerX + 12 * facing, feet - 59, centerX + (38 + attack) * facing, feet - 54 - attack * 0.25);
    graphics.lineStyle(6, accent, 1);
    graphics.lineBetween(centerX + (34 + attack) * facing, feet - 79 - attack * 0.25, centerX + (48 + attack) * facing, feet - 26 - attack * 0.25);
    graphics.fillStyle(accent, 0.95);
    graphics.fillTriangle(centerX - 19, feet - 66, centerX - 28, feet - 44, centerX - 5, feet - 50);
  }

  private drawMira(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.2;
    graphics.lineStyle(6, 0x10070e, 1);
    graphics.lineBetween(centerX - 7, feet - 25, centerX - 13 + run * 0.7, feet);
    graphics.lineBetween(centerX + 7, feet - 25, centerX + 13 - run * 0.7, feet);
    graphics.fillStyle(0xff3f9d, 1);
    graphics.fillTriangle(centerX - 15, feet - 67, centerX + 16, feet - 67, centerX + 5 * facing, feet - 24);
    graphics.fillStyle(0x4b1234, 1);
    graphics.fillRoundedRect(centerX - 13, feet - 66, 26, 39, 10);
    graphics.fillStyle(accent, 1);
    graphics.fillCircle(centerX, feet - 79, 13);
    graphics.fillStyle(0x210b1c, 1);
    graphics.fillTriangle(centerX - 14, feet - 85, centerX + 13, feet - 88, centerX - 4 * facing, feet - 99);
    graphics.lineStyle(4, 0xff3f9d, 1);
    graphics.lineBetween(centerX + 8 * facing, feet - 57, centerX + (30 + attack) * facing, feet - 42 - attack * 0.36);
    graphics.lineBetween(centerX - 6 * facing, feet - 54, centerX - (24 + attack * 0.5) * facing, feet - 37 + attack * 0.2);
    graphics.lineStyle(5, accent, 0.9);
    graphics.lineBetween(centerX + (27 + attack) * facing, feet - 55 - attack * 0.36, centerX + (43 + attack) * facing, feet - 34 - attack * 0.36);
    graphics.lineBetween(centerX - (21 + attack * 0.5) * facing, feet - 48, centerX - (38 + attack * 0.5) * facing, feet - 30);
    graphics.lineStyle(3, 0xff3f9d, 0.5);
    graphics.lineBetween(centerX - 8 * facing, feet - 90, centerX - (40 + Math.abs(run)) * facing, feet - 78 + run * 0.25);
  }

  private drawBram(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.12;
    graphics.lineStyle(11, 0x140e06, 1);
    graphics.lineBetween(centerX - 15, feet - 28, centerX - 17 + run * 0.35, feet);
    graphics.lineBetween(centerX + 15, feet - 28, centerX + 17 - run * 0.35, feet);
    graphics.fillStyle(0x6e431b, 1);
    graphics.fillRoundedRect(centerX - 30, feet - 78, 60, 54, 15);
    graphics.fillStyle(0xffb23f, 1);
    graphics.fillRoundedRect(centerX - 36, feet - 71, 18, 28, 7);
    graphics.fillRoundedRect(centerX + 18, feet - 71, 18, 28, 7);
    graphics.fillStyle(accent, 1);
    graphics.fillRect(centerX - 18, feet - 62, 36, 7);
    graphics.fillStyle(0x352516, 1);
    graphics.fillRoundedRect(centerX - 21, feet - 96, 42, 31, 9);
    graphics.fillStyle(accent, 1);
    graphics.fillRect(centerX - 14, feet - 87, 28, 6);
    graphics.lineStyle(9, 0x5a3516, 1);
    graphics.lineBetween(centerX + 22 * facing, feet - 58, centerX + (40 + attack * 0.7) * facing, feet - 49 - attack * 0.55);
    graphics.lineStyle(6, 0xffb23f, 1);
    graphics.lineBetween(centerX + (36 + attack * 0.7) * facing, feet - 78 - attack * 0.55, centerX + (54 + attack * 0.7) * facing, feet - 23 - attack * 0.55);
    graphics.fillStyle(0xffb23f, 1);
    graphics.fillRoundedRect(centerX + (42 + attack * 0.7) * facing - (facing < 0 ? 30 : 0), feet - 86 - attack * 0.55, 30, 26, 5);
  }

  private drawSuri(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.16;
    graphics.lineStyle(6, 0x100b18, 1);
    graphics.lineBetween(centerX - 8, feet - 24, centerX - 11 + run * 0.45, feet);
    graphics.lineBetween(centerX + 8, feet - 24, centerX + 11 - run * 0.45, feet);
    graphics.fillStyle(0x4c2a78, 1);
    graphics.fillTriangle(centerX - 25, feet - 20, centerX + 25, feet - 20, centerX, feet - 72);
    graphics.fillStyle(0xa66bff, 1);
    graphics.fillRoundedRect(centerX - 16, feet - 68, 32, 43, 12);
    graphics.fillStyle(accent, 1);
    graphics.fillCircle(centerX, feet - 81, 13);
    graphics.fillStyle(0x241538, 1);
    graphics.fillRect(centerX - 14, feet - 85, 28, 10);
    const orbitX = centerX + Math.cos(this.world.motionTick * 0.06) * 30 + facing * attack * 0.6;
    const orbitY = feet - 72 + Math.sin(this.world.motionTick * 0.08) * 17 - attack * 0.4;
    graphics.lineStyle(2, 0xa66bff, 0.45);
    graphics.lineBetween(centerX, feet - 55, orbitX, orbitY);
    graphics.fillStyle(0x241538, 1);
    graphics.fillCircle(orbitX, orbitY, 11);
    graphics.lineStyle(3, accent, 1);
    graphics.strokeCircle(orbitX, orbitY, 8);
    graphics.fillStyle(accent, 1);
    graphics.fillCircle(orbitX, orbitY, 3);
    graphics.lineStyle(4, 0xa66bff, 1);
    graphics.lineBetween(centerX + 10 * facing, feet - 57, centerX + (28 + attack * 0.5) * facing, feet - 49 - attack * 0.25);
  }

  private drawJuno(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.18;
    graphics.lineStyle(7, 0x07130f, 1);
    graphics.lineBetween(centerX - 8, feet - 25, centerX - 14 + run * 0.7, feet);
    graphics.lineBetween(centerX + 8, feet - 25, centerX + 14 - run * 0.7, feet);
    graphics.fillStyle(0x163d31, 1);
    graphics.fillRoundedRect(centerX - 16, feet - 68, 32, 43, 9);
    graphics.fillStyle(0x36e6a0, 1);
    graphics.fillTriangle(centerX - 24, feet - 67, centerX + 22, feet - 67, centerX, feet - 28);
    graphics.fillStyle(accent, 1);
    graphics.fillCircle(centerX, feet - 81, 13);
    graphics.fillStyle(0x3b342d, 1);
    graphics.fillTriangle(centerX - 13, feet - 86, centerX + 14, feet - 90, centerX + 4 * facing, feet - 99);
    const gauntletX = centerX + (25 + attack * 0.75) * facing;
    const gauntletY = feet - 54 - attack * 0.32;
    graphics.lineStyle(5, 0x36e6a0, 1);
    graphics.lineBetween(centerX + 9 * facing, feet - 58, gauntletX, gauntletY);
    graphics.fillStyle(0x10251f, 1);
    graphics.fillCircle(gauntletX, gauntletY, 11);
    graphics.lineStyle(3, accent, 1);
    graphics.strokeCircle(gauntletX, gauntletY, 8);
    graphics.lineStyle(3, 0x36e6a0, 0.5);
    graphics.lineBetween(centerX - 12 * facing, feet - 72, centerX - (38 + Math.abs(run)) * facing, feet - 64);
  }

  private drawOrin(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feet: number,
    facing: number,
    run: number,
    attack: number,
    tilt: number,
    accent: number,
  ): void {
    const centerX = x + tilt * 0.14;
    graphics.lineStyle(9, 0x16080b, 1);
    graphics.lineBetween(centerX - 12, feet - 27, centerX - 16 + run * 0.45, feet);
    graphics.lineBetween(centerX + 12, feet - 27, centerX + 16 - run * 0.45, feet);
    graphics.fillStyle(0x251117, 1);
    graphics.fillRoundedRect(centerX - 23, feet - 73, 46, 48, 11);
    graphics.fillStyle(0x641824, 1);
    graphics.fillTriangle(centerX - 28, feet - 68, centerX + 24, feet - 68, centerX - 4 * facing, feet - 20);
    graphics.fillStyle(accent, 1);
    graphics.fillCircle(centerX, feet - 84, 14);
    graphics.fillStyle(0xbec5ce, 1);
    graphics.fillTriangle(centerX - 14, feet - 91, centerX + 13, feet - 94, centerX + 3 * facing, feet - 103);
    const gauntletX = centerX + (31 + attack * 0.8) * facing;
    const gauntletY = feet - 56 - attack * 0.38;
    graphics.lineStyle(9, 0x2b1118, 1);
    graphics.lineBetween(centerX + 15 * facing, feet - 59, gauntletX, gauntletY);
    graphics.fillStyle(0x130b0f, 1);
    graphics.fillCircle(gauntletX, gauntletY, 15);
    graphics.lineStyle(4, 0xff4d5f, 1);
    graphics.strokeCircle(gauntletX, gauntletY, 11);
    graphics.fillStyle(accent, 0.9);
    graphics.fillCircle(gauntletX + facing * 3, gauntletY - 2, 4);
  }

  private drawProjectiles(): void {
    const graphics = this.projectileGraphics;
    const glow = this.projectileGlowGraphics;
    graphics.clear();
    glow.clear();
    for (const projectile of this.world.projectiles) {
      const owner = this.world.fighters.find((fighter) => fighter.id === projectile.ownerId);
      const fallbackColor = owner === undefined ? 0xffffff : getFighter(owner.definitionId).color;
      const style = projectileVisualStyle(projectile.moveId, fallbackColor);
      const speed = Math.max(0.001, Math.hypot(projectile.velocity.x, projectile.velocity.y));
      const forwardX = projectile.velocity.x / speed;
      const forwardY = projectile.velocity.y / speed;
      const sideX = -forwardY;
      const sideY = forwardX;
      const x = projectile.position.x;
      const y = projectile.position.y;
      const radius = projectile.radius;
      const phase = this.world.motionTick * 0.2 + projectile.id * 1.73;
      const trailLength = clamp(speed * 5.2 + radius * 1.5, 38, 92);

      graphics.lineStyle(Math.max(5, radius * 1.25), 0x02050a, 0.5);
      graphics.lineBetween(x - forwardX * trailLength, y - forwardY * trailLength + 3, x, y + 3);
      for (let layer = 3; layer >= 1; layer -= 1) {
        const ratio = layer / 3;
        glow.lineStyle(Math.max(2, radius * (0.22 + ratio * 0.48)), style.color, 0.11 + (1 - ratio) * 0.13);
        glow.lineBetween(
          x - forwardX * trailLength * ratio,
          y - forwardY * trailLength * ratio,
          x - forwardX * radius * 0.2,
          y - forwardY * radius * 0.2,
        );
      }
      for (let mote = 1; mote <= 3; mote += 1) {
        const distance = radius * 1.2 + mote * trailLength * 0.23;
        const sway = Math.sin(phase + mote * 2.1) * radius * (0.22 + mote * 0.05);
        glow.fillStyle(mote === 1 ? style.accent : style.color, 0.34 - mote * 0.055);
        glow.fillCircle(
          x - forwardX * distance + sideX * sway,
          y - forwardY * distance + sideY * sway,
          Math.max(1.5, radius * (0.28 - mote * 0.045)),
        );
      }

      glow.fillStyle(style.color, 0.12);
      glow.fillCircle(x, y, radius * (2.45 + Math.sin(phase) * 0.14));
      glow.fillStyle(style.accent, 0.18);
      glow.fillCircle(x, y, radius * 1.45);

      if (style.kind === 'lance') this.drawLanceProjectile(graphics, glow, x, y, radius, forwardX, forwardY, sideX, sideY, style, phase);
      else if (style.kind === 'comet') this.drawCometProjectile(graphics, glow, x, y, radius, style, phase);
      else if (style.kind === 'gale') this.drawGaleProjectile(graphics, glow, x, y, radius, forwardX, forwardY, sideX, sideY, style, phase);
      else if (style.kind === 'singularity') this.drawSingularityProjectile(graphics, glow, x, y, radius, style, phase);
      else this.drawPulseProjectile(graphics, x, y, radius, style);
    }
  }

  private drawLanceProjectile(
    graphics: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    forwardX: number,
    forwardY: number,
    sideX: number,
    sideY: number,
    style: ProjectileVisualStyle,
    phase: number,
  ): void {
    const tipX = x + forwardX * radius * 1.9;
    const tipY = y + forwardY * radius * 1.9;
    const rearX = x - forwardX * radius * 1.2;
    const rearY = y - forwardY * radius * 1.2;
    const spread = radius * 0.72;
    graphics.fillStyle(0x02070d, 0.96);
    graphics.fillTriangle(tipX + forwardX * 3, tipY + forwardY * 3, rearX + sideX * (spread + 3), rearY + sideY * (spread + 3), rearX - sideX * (spread + 3), rearY - sideY * (spread + 3));
    graphics.fillStyle(style.color, 1);
    graphics.fillTriangle(tipX, tipY, rearX + sideX * spread, rearY + sideY * spread, rearX - sideX * spread, rearY - sideY * spread);
    graphics.fillStyle(style.accent, 1);
    graphics.fillTriangle(
      x + forwardX * radius * 1.35,
      y + forwardY * radius * 1.35,
      x - forwardX * radius * 0.55 + sideX * radius * 0.22,
      y - forwardY * radius * 0.55 + sideY * radius * 0.22,
      x - forwardX * radius * 0.55 - sideX * radius * 0.22,
      y - forwardY * radius * 0.55 - sideY * radius * 0.22,
    );
    for (let wing = -1; wing <= 1; wing += 2) {
      const offset = radius * (1.7 + Math.sin(phase) * 0.08);
      glow.lineStyle(2.5, style.accent, 0.68);
      glow.lineBetween(
        x - forwardX * offset + sideX * wing * radius * 0.55,
        y - forwardY * offset + sideY * wing * radius * 0.55,
        x - forwardX * radius * 0.7,
        y - forwardY * radius * 0.7,
      );
    }
  }

  private drawCometProjectile(
    graphics: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    style: ProjectileVisualStyle,
    phase: number,
  ): void {
    graphics.fillStyle(0x080413, 0.98);
    graphics.fillCircle(x, y, radius * 1.08);
    graphics.lineStyle(3, style.color, 0.95);
    graphics.strokeCircle(x, y, radius * 0.88);
    graphics.fillStyle(style.color, 0.92);
    graphics.fillCircle(x, y, radius * 0.64);
    graphics.fillStyle(style.accent, 0.96);
    graphics.fillCircle(x - radius * 0.18, y - radius * 0.2, radius * 0.27);
    glow.lineStyle(2, style.accent, 0.62);
    glow.strokeEllipse(x, y, radius * 3.2, radius * 1.35);
    for (let satellite = 0; satellite < 3; satellite += 1) {
      const angle = phase + satellite * (Math.PI * 2 / 3);
      const satelliteX = x + Math.cos(angle) * radius * 1.55;
      const satelliteY = y + Math.sin(angle) * radius * 0.62;
      glow.fillStyle(satellite === 0 ? style.accent : style.color, 0.85);
      glow.fillCircle(satelliteX, satelliteY, Math.max(2, radius * 0.16));
    }
  }

  private drawGaleProjectile(
    graphics: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    forwardX: number,
    forwardY: number,
    sideX: number,
    sideY: number,
    style: ProjectileVisualStyle,
    phase: number,
  ): void {
    const tipX = x + forwardX * radius * 1.55;
    const tipY = y + forwardY * radius * 1.55;
    const rearX = x - forwardX * radius * 1.15;
    const rearY = y - forwardY * radius * 1.15;
    graphics.fillStyle(0x03100b, 0.92);
    graphics.fillTriangle(tipX + forwardX * 2, tipY + forwardY * 2, rearX + sideX * radius * 0.9, rearY + sideY * radius * 0.9, rearX - sideX * radius * 0.9, rearY - sideY * radius * 0.9);
    graphics.fillStyle(style.color, 0.95);
    graphics.fillTriangle(tipX, tipY, rearX + sideX * radius * 0.58, rearY + sideY * radius * 0.58, rearX - sideX * radius * 0.58, rearY - sideY * radius * 0.58);
    graphics.fillStyle(style.accent, 1);
    graphics.fillCircle(x + forwardX * radius * 0.34, y + forwardY * radius * 0.34, radius * 0.29);
    for (let arc = 0; arc < 2; arc += 1) {
      const offset = (arc === 0 ? -1 : 1) * radius * (0.88 + Math.sin(phase + arc) * 0.12);
      glow.lineStyle(2, style.color, 0.62);
      glow.lineBetween(
        x - forwardX * radius * 2.8 + sideX * offset,
        y - forwardY * radius * 2.8 + sideY * offset,
        x - forwardX * radius * 0.35 + sideX * offset * 0.18,
        y - forwardY * radius * 0.35 + sideY * offset * 0.18,
      );
    }
  }

  private drawSingularityProjectile(
    graphics: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    style: ProjectileVisualStyle,
    phase: number,
  ): void {
    glow.lineStyle(4, style.color, 0.34);
    glow.strokeCircle(x, y, radius * (1.55 + Math.sin(phase * 1.4) * 0.12));
    graphics.fillStyle(0x020207, 1);
    graphics.fillCircle(x, y, radius * 1.08);
    graphics.lineStyle(3, style.color, 0.96);
    graphics.strokeCircle(x, y, radius * 0.92);
    graphics.lineStyle(2, style.accent, 0.74);
    graphics.strokeCircle(x, y, radius * 0.56);
    graphics.fillStyle(0x050207, 1);
    graphics.fillCircle(x, y, radius * 0.43);
    for (let ray = 0; ray < 5; ray += 1) {
      const angle = phase * 0.7 + ray * (Math.PI * 2 / 5);
      const inner = radius * 1.05;
      const outer = radius * (1.62 + (ray % 2) * 0.18);
      glow.lineStyle(ray % 2 === 0 ? 3 : 2, ray % 2 === 0 ? style.accent : style.color, 0.56);
      glow.lineBetween(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner, x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    }
  }

  private drawPulseProjectile(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    style: ProjectileVisualStyle,
  ): void {
    graphics.fillStyle(0x03070c, 0.95);
    graphics.fillCircle(x, y, radius * 1.15);
    graphics.fillStyle(style.color, 0.96);
    graphics.fillCircle(x, y, radius);
    graphics.lineStyle(2, style.accent, 0.8);
    graphics.strokeCircle(x, y, radius * 0.7);
    graphics.fillStyle(style.accent, 0.96);
    graphics.fillCircle(x - radius * 0.24, y - radius * 0.24, radius * 0.28);
  }

  private drawDebug(): void {
    const graphics = this.debugGraphics;
    graphics.clear();
    if (!this.world.training.showHitboxes) return;
    for (const fighter of this.world.fighters) {
      const hurtbox = fighterHurtbox(fighter);
      graphics.lineStyle(2, 0x42f5a1, 0.9);
      graphics.strokeRect(hurtbox.x, hurtbox.y, hurtbox.width, hurtbox.height);
      if (fighter.attack !== null) {
        const move = Object.values(getFighter(fighter.definitionId).moves).find((candidate) => candidate.id === fighter.attack?.moveId);
        if (move !== undefined && fighter.attack.frame >= move.startupFrames && fighter.attack.frame < move.startupFrames + move.activeFrames) {
          const hitbox = attackHitbox(fighter, move);
          graphics.lineStyle(3, 0xff4d66, 0.95);
          graphics.strokeRect(hitbox.x, hitbox.y, hitbox.width, hitbox.height);
        }
      }
    }
  }

  private handleCombatEvent(event: CombatEvent): void {
    this.launch.callbacks.onCombatEvent(event);
    switch (event.type) {
      case 'jump':
        this.launch.audio.play('jump');
        this.emitParticles(event.position.x, event.position.y, 0xc8f7ff, 7, 'dust');
        break;
      case 'attack-start':
        this.launch.audio.play(event.moveId?.includes('special') ? 'special' : 'swing', 0.7);
        break;
      case 'hit':
        this.launch.audio.play('hit');
        this.launch.audio.vibrate(18);
        this.emitImpact(event, false);
        break;
      case 'strong-hit':
        this.launch.audio.play('heavy', Math.min(1.3, event.value / 10));
        this.launch.audio.vibrate([28, 18, 35]);
        this.emitImpact(event, true);
        break;
      case 'dodge':
        this.launch.audio.play('dodge');
        this.emitParticles(event.position.x, event.position.y - 38, 0xb9eeff, 6, 'trail');
        break;
      case 'projectile': {
        this.launch.audio.play('special', 0.72);
        const actor = this.world.fighters.find((fighter) => fighter.id === event.actorId);
        const fallbackColor = actor === undefined ? 0xffffff : getFighter(actor.definitionId).color;
        const style = projectileVisualStyle(event.moveId ?? '', fallbackColor);
        this.emitParticles(event.position.x, event.position.y, style.color, 11, 'trail');
        this.emitParticles(event.position.x, event.position.y, style.accent, 2, 'ring');
        this.cameraZoomPunch = Math.max(this.cameraZoomPunch, 0.008);
        break;
      }
      case 'land':
        this.emitParticles(event.position.x, event.position.y, 0xb6c5d6, 5, 'dust');
        break;
      case 'ringout':
        this.launch.audio.play('ringout');
        this.launch.audio.vibrate([45, 20, 70]);
        this.emitParticles(event.position.x, event.position.y, 0xffffff, 26, 'trail');
        this.cameraZoomPunch = Math.max(this.cameraZoomPunch, 0.075);
        if (!this.launch.getSettings().reducedMotion) this.cameras.main.flash(130, 214, 238, 255, false);
        break;
      case 'match-end':
        this.launch.audio.play('victory');
        break;
      case 'respawn':
        this.emitParticles(event.position.x, event.position.y, 0x8deaff, 12, 'ring');
        break;
    }
  }

  private emitImpact(event: CombatEvent, strong: boolean): void {
    const actor = this.world.fighters.find((fighter) => fighter.id === event.actorId);
    const target = event.targetId === null
      ? undefined
      : this.world.fighters.find((fighter) => fighter.id === event.targetId);
    const color = actor === undefined ? 0xffffff : getFighter(actor.definitionId).color;
    const direction: -1 | 1 = actor === undefined
      ? 1
      : (target?.position.x ?? event.position.x) >= actor.position.x ? 1 : -1;
    const power = clamp(event.value / 10, 0.48, strong ? 1.55 : 1.05);
    const maximumLife = strong ? 22 : 15;
    this.impactBursts.push({
      x: event.position.x,
      y: event.position.y,
      direction,
      color,
      power,
      life: maximumLife,
      maximumLife,
      holdFrames: strong ? 3 : 1,
      strong,
    });
    if (this.impactBursts.length > IMPACT_CAPACITY) this.impactBursts.shift();
    this.emitParticles(event.position.x, event.position.y, color, strong ? 24 : 13, 'spark');
    this.emitParticles(event.position.x, event.position.y, 0xffffff, strong ? 10 : 5, 'trail');
    if (strong) this.emitParticles(event.position.x, event.position.y, 0xffe8a6, 3, 'ring');

    const settings = this.launch.getSettings();
    if (!settings.reducedMotion) {
      this.cameraZoomPunch = Math.max(this.cameraZoomPunch, strong ? 0.052 * power : 0.016 * power);
      this.cameraImpactX = direction * (strong ? -18 : -7) * power;
      this.cameraImpactY = strong ? 7 * power : 2;
      if (settings.screenShake) {
        this.cameras.main.shake(
          strong ? 125 : 58,
          strong ? Math.min(0.014, event.value * 0.00072) : Math.min(0.0035, event.value * 0.0003),
        );
      }
      if (strong) this.cameras.main.flash(68, 255, 235, 196, false);
    }
  }

  private emitParticles(x: number, y: number, color: number, count: number, kind: EffectParticle['kind']): void {
    let emitted = 0;
    for (const particle of this.particles) {
      if (particle.active) continue;
      const angle = ((emitted * 2.399) + this.world.tick * 0.17) % (Math.PI * 2);
      const speed = kind === 'dust' ? 2.2 + (emitted % 4) * 0.4 : 3.2 + (emitted % 6) * 0.7;
      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.velocityX = Math.cos(angle) * speed;
      particle.velocityY = Math.sin(angle) * speed - (kind === 'dust' ? 1.7 : 0);
      particle.life = kind === 'trail' ? 34 : 22 + (emitted % 8);
      particle.maximumLife = particle.life;
      particle.color = color;
      particle.size = kind === 'ring' ? 10 : 2.5 + (emitted % 4);
      particle.kind = kind;
      emitted += 1;
      if (emitted >= count) break;
    }
  }

  private updateParticles(): void {
    this.impactBursts = this.impactBursts.filter((impact) => {
      if (impact.holdFrames > 0) impact.holdFrames -= 1;
      else impact.life -= 1;
      return impact.life > 0;
    });
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= 1;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.velocityX;
      particle.y += particle.velocityY;
      particle.velocityX *= 0.94;
      particle.velocityY = particle.velocityY * 0.94 + (particle.kind === 'dust' ? 0.08 : 0.02);
    }
  }

  private drawParticles(): void {
    const graphics = this.effectGraphics;
    graphics.clear();
    for (const impact of this.impactBursts) {
      const ratio = impact.life / impact.maximumLife;
      const progress = 1 - ratio;
      const core = (impact.strong ? 18 : 11) * impact.power;
      const radius = core + progress * (impact.strong ? 72 : 42) * impact.power;
      graphics.lineStyle(Math.max(1, 5 * ratio), 0xffffff, ratio * (impact.strong ? 0.9 : 0.68));
      graphics.strokeCircle(impact.x, impact.y, radius * 0.46);
      graphics.lineStyle(Math.max(1, 3 * ratio), impact.color, ratio * 0.82);
      graphics.strokeEllipse(impact.x, impact.y, radius * 1.35, radius * 0.72);

      const rayCount = impact.strong ? 12 : 8;
      for (let index = 0; index < rayCount; index += 1) {
        const spread = (index / Math.max(1, rayCount - 1) - 0.5) * Math.PI * 1.45;
        const angle = (impact.direction > 0 ? 0 : Math.PI) + spread;
        const start = core * (0.45 + (index % 3) * 0.12);
        const length = radius * (0.75 + (index % 4) * 0.13);
        graphics.lineStyle(Math.max(1, (impact.strong ? 5 : 3) * ratio), index % 3 === 0 ? 0xffffff : impact.color, ratio * 0.86);
        graphics.lineBetween(
          impact.x + Math.cos(angle) * start,
          impact.y + Math.sin(angle) * start * 0.62,
          impact.x + Math.cos(angle) * length,
          impact.y + Math.sin(angle) * length * 0.62,
        );
      }
      graphics.fillStyle(impact.color, ratio * 0.52);
      graphics.fillEllipse(impact.x - impact.direction * progress * 6, impact.y, core * 2.8, core * 1.65);
      graphics.fillStyle(0xffffff, ratio * 0.95);
      graphics.fillTriangle(
        impact.x - core * impact.direction,
        impact.y,
        impact.x,
        impact.y - core * 0.75,
        impact.x + core * 1.3 * impact.direction,
        impact.y,
      );
      graphics.fillTriangle(
        impact.x - core * impact.direction,
        impact.y,
        impact.x,
        impact.y + core * 0.75,
        impact.x + core * 1.3 * impact.direction,
        impact.y,
      );
    }
    for (const particle of this.particles) {
      if (!particle.active) continue;
      const ratio = particle.life / particle.maximumLife;
      if (particle.kind === 'ring') {
        graphics.lineStyle(3, particle.color, ratio * 0.8);
        graphics.strokeCircle(particle.x, particle.y, particle.size + (1 - ratio) * 38);
      } else if (particle.kind === 'trail') {
        graphics.lineStyle(Math.max(1, particle.size * ratio), particle.color, ratio * 0.75);
        graphics.lineBetween(particle.x, particle.y, particle.x - particle.velocityX * 4, particle.y - particle.velocityY * 4);
      } else {
        graphics.fillStyle(particle.color, ratio * 0.9);
        graphics.fillCircle(particle.x, particle.y, Math.max(1, particle.size * ratio));
      }
    }
  }

  private activeParticleCount(): number {
    return this.particles.reduce((count, particle) => count + (particle.active ? 1 : 0), 0);
  }

  private updateCamera(delta: number): void {
    const [first, second] = this.world.fighters;
    const camera = this.cameras.main;
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    // Fill the viewport before applying fighter-distance framing. Using a contain
    // scale here left wide phones looking at empty space outside the 16:9 arena.
    const baseZoom = Math.max(width / GAME_CONFIG.worldWidth, height / GAME_CONFIG.worldHeight)
      * CAMERA_COVER_OVERSCAN;
    const distance = Math.abs(first.position.x - second.position.x) + Math.abs(first.position.y - second.position.y) * 0.42;
    const dynamicZoom = clamp(1.18 - distance / 2600, GAME_CONFIG.cameraMinZoom, GAME_CONFIG.cameraMaxZoom);
    const targetZoom = baseZoom * dynamicZoom * (1 + this.cameraZoomPunch);
    camera.zoom = Phaser.Math.Linear(camera.zoom, targetZoom, clamp(delta / 180, 0.04, 0.18));
    const targetX = (first.position.x + second.position.x) / 2 + this.cameraImpactX;
    const targetY = clamp((first.position.y + second.position.y) / 2 - 78 + this.cameraImpactY, 250, 430);
    const viewCenter = camera.midPoint;
    camera.centerOn(
      Phaser.Math.Linear(viewCenter.x, targetX, 0.075),
      Phaser.Math.Linear(viewCenter.y, targetY, 0.075),
    );
    const decay = clamp(delta / 115, 0.06, 0.24);
    this.cameraZoomPunch = Phaser.Math.Linear(this.cameraZoomPunch, 0, decay);
    this.cameraImpactX = Phaser.Math.Linear(this.cameraImpactX, 0, decay);
    this.cameraImpactY = Phaser.Math.Linear(this.cameraImpactY, 0, decay);
  }
}
