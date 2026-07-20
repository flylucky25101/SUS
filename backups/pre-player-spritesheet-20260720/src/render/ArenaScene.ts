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

const PARTICLE_CAPACITY = 96;

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
  private projectileGraphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private fighterGraphics!: Record<FighterInstanceId, Phaser.GameObjects.Graphics>;
  private particles: EffectParticle[] = [];
  private lastHudTick = -1;

  constructor(launch: ArenaLaunch) {
    super({ key: 'ArenaScene' });
    this.launch = launch;
    this.world = createWorld(launch.options);
    this.ai = createAiControllers(launch.options.seed, launch.options.difficulty);
  }

  create(): void {
    this.backgroundGraphics = this.add.graphics().setDepth(-20);
    this.stageGraphics = this.add.graphics().setDepth(-5);
    this.projectileGraphics = this.add.graphics().setDepth(6);
    this.effectGraphics = this.add.graphics().setDepth(12);
    this.debugGraphics = this.add.graphics().setDepth(20);
    this.fighterGraphics = {
      p1: this.add.graphics().setDepth(4),
      p2: this.add.graphics().setDepth(4),
    };
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
    for (const fighter of this.world.fighters) this.drawFighter(fighter, this.fighterGraphics[fighter.id]);
    this.drawProjectiles();
    this.drawParticles();
    this.drawDebug();
  }

  private drawStage(): void {
    const graphics = this.stageGraphics;
    const stage = getStage(this.world.options.stageId);
    graphics.clear();
    for (const source of stage.platforms) {
      const platform = platformAtTick(source, this.world.motionTick, this.world.options.hazards);
      const primary = stage.theme === 'spire' ? 0x1dd4ef : 0x73e2b8;
      const surface = stage.theme === 'spire' ? 0x202d3d : 0x293746;
      graphics.fillStyle(primary, 0.12);
      graphics.fillRoundedRect(platform.x - 8, platform.y - 8, platform.width + 16, platform.height + 20, 12);
      graphics.fillStyle(surface, 1);
      graphics.fillRoundedRect(platform.x, platform.y, platform.width, platform.height, platform.id === 'main' ? 12 : 7);
      graphics.fillStyle(primary, 0.9);
      graphics.fillRoundedRect(platform.x + 4, platform.y, platform.width - 8, 4, 2);
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
    graphics.clear();
    graphics.setAlpha(alpha);

    if (fighter.invulnerabilityFrames > 0) {
      graphics.lineStyle(3, 0xffffff, 0.3 + Math.abs(Math.sin(this.world.tick / 4)) * 0.45);
      graphics.strokeCircle(x, feet - definition.stats.height * 0.52, definition.stats.width * 0.78);
    }
    if (fighter.armorFrames > 0) {
      graphics.lineStyle(5, 0xffd06b, 0.7);
      graphics.strokeRoundedRect(x - definition.stats.width * 0.62, feet - definition.stats.height - 6, definition.stats.width * 1.24, definition.stats.height + 10, 18);
    }

    graphics.lineStyle(7, 0x05070b, 0.9);
    graphics.fillStyle(definition.color, 1);
    if (fighter.definitionId === 'kade') this.drawKade(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
    else if (fighter.definitionId === 'mira') this.drawMira(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
    else if (fighter.definitionId === 'bram') this.drawBram(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
    else this.drawSuri(graphics, x, feet, facing, runSwing, attackSwing, hurtTilt, definition.accent);
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

  private drawProjectiles(): void {
    const graphics = this.projectileGraphics;
    graphics.clear();
    for (const projectile of this.world.projectiles) {
      const owner = this.world.fighters.find((fighter) => fighter.id === projectile.ownerId);
      const color = owner === undefined ? 0xffffff : getFighter(owner.definitionId).color;
      graphics.lineStyle(Math.max(2, projectile.radius * 0.5), color, 0.18);
      graphics.lineBetween(projectile.position.x - projectile.velocity.x * 3, projectile.position.y - projectile.velocity.y * 3, projectile.position.x, projectile.position.y);
      graphics.fillStyle(color, 0.25);
      graphics.fillCircle(projectile.position.x, projectile.position.y, projectile.radius * 1.65);
      graphics.fillStyle(color, 0.95);
      graphics.fillCircle(projectile.position.x, projectile.position.y, projectile.radius);
      graphics.fillStyle(0xffffff, 0.9);
      graphics.fillCircle(projectile.position.x - projectile.radius * 0.25, projectile.position.y - projectile.radius * 0.25, projectile.radius * 0.32);
    }
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
        this.emitParticles(event.position.x, event.position.y, 0xffffff, 10, 'spark');
        break;
      case 'strong-hit':
        this.launch.audio.play('heavy', Math.min(1.3, event.value / 10));
        this.launch.audio.vibrate([28, 18, 35]);
        this.emitParticles(event.position.x, event.position.y, 0xffdf8a, 18, 'spark');
        if (this.launch.getSettings().screenShake && !this.launch.getSettings().reducedMotion) this.cameras.main.shake(110, Math.min(0.012, event.value * 0.00065));
        break;
      case 'dodge':
        this.launch.audio.play('dodge');
        this.emitParticles(event.position.x, event.position.y - 38, 0xb9eeff, 6, 'trail');
        break;
      case 'projectile':
        this.launch.audio.play('special', 0.72);
        break;
      case 'land':
        this.emitParticles(event.position.x, event.position.y, 0xb6c5d6, 5, 'dust');
        break;
      case 'ringout':
        this.launch.audio.play('ringout');
        this.launch.audio.vibrate([45, 20, 70]);
        this.emitParticles(event.position.x, event.position.y, 0xffffff, 26, 'trail');
        break;
      case 'match-end':
        this.launch.audio.play('victory');
        break;
      case 'respawn':
        this.emitParticles(event.position.x, event.position.y, 0x8deaff, 12, 'ring');
        break;
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
    const baseZoom = Math.min(width / GAME_CONFIG.worldWidth, height / GAME_CONFIG.worldHeight);
    const distance = Math.abs(first.position.x - second.position.x) + Math.abs(first.position.y - second.position.y) * 0.42;
    const dynamicZoom = clamp(1.03 - distance / 1900, GAME_CONFIG.cameraMinZoom, GAME_CONFIG.cameraMaxZoom);
    const targetZoom = baseZoom * dynamicZoom;
    camera.zoom = Phaser.Math.Linear(camera.zoom, targetZoom, clamp(delta / 180, 0.04, 0.18));
    const targetX = (first.position.x + second.position.x) / 2;
    const targetY = clamp((first.position.y + second.position.y) / 2 - 78, 250, 430);
    const viewCenter = camera.midPoint;
    camera.centerOn(
      Phaser.Math.Linear(viewCenter.x, targetX, 0.075),
      Phaser.Math.Linear(viewCenter.y, targetY, 0.075),
    );
  }
}
