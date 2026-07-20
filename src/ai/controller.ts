import { clamp, SeededRandom } from '../core/math';
import { EMPTY_COMMAND, type Difficulty, type FighterInstanceId, type InputCommand, type WorldState } from '../core/types';
import { getFighter } from '../data/fighters';
import { getStage } from '../data/stages';

interface DifficultyProfile {
  reactionFrames: number;
  mistakeChance: number;
  predictionFrames: number;
  dodgeChance: number;
  recoveryAccuracy: number;
}

const PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = Object.freeze({
  easy: { reactionFrames: 24, mistakeChance: 0.3, predictionFrames: 0, dodgeChance: 0.12, recoveryAccuracy: 0.66 },
  normal: { reactionFrames: 12, mistakeChance: 0.13, predictionFrames: 5, dodgeChance: 0.27, recoveryAccuracy: 0.86 },
  hard: { reactionFrames: 6, mistakeChance: 0.045, predictionFrames: 10, dodgeChance: 0.42, recoveryAccuracy: 0.96 },
});

type AiAction = 'approach' | 'retreat' | 'normal' | 'special' | 'jump' | 'dodge' | 'recover' | 'wait';

function freshCommand(): InputCommand {
  return { ...EMPTY_COMMAND };
}

export class AiController {
  private readonly random: SeededRandom;
  private readonly profile: DifficultyProfile;
  private command: InputCommand = freshCommand();
  private decisionFrames = 0;
  private pulseRelease = false;
  private previousAction: AiAction = 'wait';
  private repeatedActions = 0;
  private stuckFrames = 0;
  private previousX = 0;
  private queuedNeutralProjectile = false;

  constructor(seed: number, difficulty: Difficulty) {
    this.random = new SeededRandom(seed);
    this.profile = PROFILES[difficulty];
  }

  next(state: WorldState, selfId: FighterInstanceId): InputCommand {
    const self = state.fighters.find((fighter) => fighter.id === selfId);
    const opponent = state.fighters.find((fighter) => fighter.id !== selfId);
    if (self === undefined || opponent === undefined || state.ended || state.paused) return freshCommand();
    if (state.options.mode === 'training' && selfId === 'p2') return this.trainingCommand(state);

    if (Math.abs(self.position.x - this.previousX) < 0.5 && !self.grounded) this.stuckFrames += 1;
    else this.stuckFrames = Math.max(0, this.stuckFrames - 2);
    this.previousX = self.position.x;

    if (this.pulseRelease) {
      this.command.normal = false;
      this.command.special = false;
      this.command.jump = false;
      this.command.dodge = false;
      this.pulseRelease = false;
      return { ...this.command };
    }

    this.decisionFrames -= 1;
    if (this.decisionFrames <= 0) {
      const jitter = Math.floor(this.random.range(-2, 3));
      this.decisionFrames = Math.max(2, this.profile.reactionFrames + jitter);
      this.command = this.decide(state, selfId);
    }
    return { ...this.command };
  }

  private decide(state: WorldState, selfId: FighterInstanceId): InputCommand {
    const self = state.fighters.find((fighter) => fighter.id === selfId);
    const opponent = state.fighters.find((fighter) => fighter.id !== selfId);
    if (self === undefined || opponent === undefined) return freshCommand();
    const command = freshCommand();
    const stage = getStage(state.options.stageId);
    const main = stage.platforms.find((platform) => platform.id === 'main');
    if (main === undefined) return command;
    const center = main.x + main.width / 2;
    const leftSafe = main.x + 42;
    const rightSafe = main.x + main.width - 42;
    const outsideMain = self.position.x < leftSafe || self.position.x > rightSafe;
    const deepBelow = self.position.y > main.y + 42;
    const recoveryRisk = outsideMain || deepBelow || self.position.y > 565;

    if (recoveryRisk) {
      const towardCenter = Math.sign(center - self.position.x) || 1;
      command.moveX = towardCenter;
      command.moveY = -1;
      const accurate = this.random.chance(this.profile.recoveryAccuracy);
      if (self.jumpsRemaining > 0 && (self.position.y > 500 || this.stuckFrames > 24) && accurate) {
        command.jump = true;
        this.markPulse('recover');
      } else if (!self.recoveryUsed && (self.position.y > 540 || self.velocity.y > 7 || this.stuckFrames > 40)) {
        command.special = true;
        this.markPulse('recover');
      }
      return command;
    }

    const predictedX = opponent.position.x + opponent.velocity.x * this.profile.predictionFrames;
    const dx = predictedX - self.position.x;
    const dy = opponent.position.y - self.position.y;
    const distance = Math.hypot(dx, dy * 0.7);
    const direction = Math.sign(dx) || self.facing;
    const definition = getFighter(self.definitionId);
    const opponentDefinition = getFighter(opponent.definitionId);

    const incomingProjectile = state.projectiles.find((projectile) => {
      if (projectile.ownerId === selfId) return false;
      const projectileDx = projectile.position.x - self.position.x;
      const approaching = projectileDx * projectile.velocity.x < 0;
      return approaching && Math.abs(projectileDx) < 230 && Math.abs(projectile.position.y - (self.position.y - 42)) < 78;
    });
    if (incomingProjectile !== undefined) {
      const responseByRole = { rush: 0.65, vanguard: 0.64, tank: 0.16, control: 0.56 } as const;
      const owner = state.fighters.find((fighter) => fighter.id === incomingProjectile.ownerId);
      const ownerIsController = owner !== undefined && getFighter(owner.definitionId).role === 'control';
      const responseChance = (ownerIsController ? responseByRole[definition.role] : 0.36) * (1 - this.profile.mistakeChance);
      if (this.random.chance(responseChance)) {
        if (definition.role === 'vanguard' && ownerIsController) {
          command.moveX = 0;
          command.moveY = 1;
          command.special = true;
          this.markPulse('special');
          return command;
        }
        const projectileDirection = Math.sign(incomingProjectile.position.x - self.position.x);
        command.moveX = definition.role === 'rush' || definition.role === 'vanguard' ? projectileDirection * 0.62 : -projectileDirection * 0.35;
        const dodgePreference = definition.role === 'vanguard' ? 0.82 : definition.role === 'rush' ? 0.3 : 0.42;
        if (self.dodgeCooldownFrames === 0 && this.random.chance(dodgePreference)) {
          command.dodge = true;
          this.markPulse('dodge');
        } else {
          command.jump = true;
          this.markPulse('jump');
        }
        return command;
      }
    }

    if (this.queuedNeutralProjectile) {
      const unsafeAim = (self.position.x < leftSafe + 54 && direction < 0)
        || (self.position.x > rightSafe - 54 && direction > 0);
      if (unsafeAim) {
        this.queuedNeutralProjectile = false;
        command.moveX = Math.sign(center - self.position.x) || 1;
        this.trackAction('retreat');
        return command;
      }
      if (self.facing !== direction) {
        command.moveX = direction;
        this.trackAction('approach');
        return command;
      }
      this.queuedNeutralProjectile = false;
      command.special = true;
      this.markPulse('special');
      return command;
    }

    if (self.position.x < leftSafe + 40 || self.position.x > rightSafe - 40) command.moveX = Math.sign(center - self.position.x);
    const threatened = opponent.status === 'attack' && distance < 125;
    const matchupDefense = definition.role === 'vanguard' && opponentDefinition.role === 'rush' ? 1.38 : 1;
    if (threatened && self.dodgeCooldownFrames === 0 && this.random.chance(this.profile.dodgeChance * matchupDefense)) {
      command.moveX = -direction;
      command.dodge = true;
      this.markPulse('dodge');
      return command;
    }

    if (this.random.chance(this.profile.mistakeChance)) {
      command.moveX = this.random.range(-0.45, 0.45);
      if (this.random.chance(0.24)) command.jump = true;
      this.markPulse(command.jump ? 'jump' : 'wait');
      return command;
    }

    switch (definition.role) {
      case 'rush':
        this.rushDecision(command, distance, direction, dy, opponentDefinition.role);
        break;
      case 'tank':
        this.tankDecision(command, distance, direction, dy, opponentDefinition.role);
        break;
      case 'control':
        this.controlDecision(command, state, selfId, distance, direction, dy, self.facing, opponentDefinition.role);
        break;
      case 'vanguard':
        this.vanguardDecision(command, distance, direction, dy, opponentDefinition.role);
        break;
    }

    const edgeSafetyDirection = self.position.x < leftSafe + 54 ? 1 : self.position.x > rightSafe - 54 ? -1 : 0;
    if (edgeSafetyDirection !== 0) {
      const actionDirection = Math.sign(command.moveX) || direction;
      if ((command.normal || command.special) && actionDirection !== edgeSafetyDirection) {
        command.normal = false;
        command.special = false;
        this.trackAction('retreat');
      }
      command.moveX = edgeSafetyDirection * Math.max(0.72, Math.abs(command.moveX));
    }

    if (this.repeatedActions >= 4) {
      command.normal = false;
      command.special = false;
      command.jump = true;
      command.moveX = -direction * 0.7;
      this.markPulse('jump');
    }
    if (command.normal || command.special || command.jump || command.dodge) this.pulseRelease = true;
    return command;
  }

  private trainingCommand(state: WorldState): InputCommand {
    const command = freshCommand();
    if (state.training.behavior === 'move') command.moveX = Math.sin(state.tick / 75) > 0 ? 0.72 : -0.72;
    if (state.training.behavior === 'attack' && state.tick % 48 === 0) {
      command.normal = true;
    }
    return command;
  }

  private rushDecision(
    command: InputCommand,
    distance: number,
    direction: number,
    dy: number,
    opponentRole: ReturnType<typeof getFighter>['role'],
  ): void {
    if (distance > 105) {
      command.moveX = direction;
      if (distance > 250 && this.random.chance(0.18)) {
        command.special = true;
        this.markPulse('special');
      } else if (Math.abs(dy) > 65 && this.random.chance(0.25)) {
        command.jump = true;
        this.markPulse('jump');
      } else this.trackAction('approach');
      return;
    }
    command.moveX = direction * 0.65;
    command.moveY = dy < -55 ? -1 : dy > 55 ? 1 : 0;
    const normalChance = opponentRole === 'control' ? 0.82 : opponentRole === 'tank' ? 0.68 : 0.74;
    if (this.random.chance(normalChance)) {
      command.normal = true;
      this.markPulse('normal');
    } else {
      command.special = true;
      this.markPulse('special');
    }
  }

  private tankDecision(
    command: InputCommand,
    distance: number,
    direction: number,
    dy: number,
    opponentRole: ReturnType<typeof getFighter>['role'],
  ): void {
    if (distance > 150) {
      command.moveX = direction * 0.72;
      if (Math.abs(dy) > 80 && this.random.chance(0.18)) command.jump = true;
      this.trackAction(command.jump ? 'jump' : 'approach');
      return;
    }
    command.moveX = direction * (distance > 88 ? 0.6 : 0.3);
    command.moveY = dy < -55 ? -1 : distance < 76 ? 1 : 0;
    const normalChance = opponentRole === 'vanguard' ? 0.81 : opponentRole === 'rush' ? 0.74 : 0.63;
    if (this.random.chance(normalChance)) command.normal = true;
    else command.special = true;
    this.markPulse(command.normal ? 'normal' : 'special');
  }

  private controlDecision(
    command: InputCommand,
    state: WorldState,
    selfId: FighterInstanceId,
    distance: number,
    direction: number,
    dy: number,
    facing: -1 | 1,
    opponentRole: ReturnType<typeof getFighter>['role'],
  ): void {
    const activeProjectiles = state.projectiles.filter((projectile) => projectile.ownerId === selfId).length;
    if (opponentRole === 'vanguard' && distance < 125) {
      command.moveX = 0;
      this.trackAction('wait');
      return;
    }
    if (distance < 125) {
      command.moveX = -direction;
      if (this.random.chance(0.46)) {
        command.moveY = 1;
        command.special = true;
        this.markPulse('special');
      } else if (this.random.chance(0.35)) {
        command.jump = true;
        this.markPulse('jump');
      } else {
        command.normal = true;
        this.markPulse('normal');
      }
      return;
    }
    const preferredMinimum = opponentRole === 'tank' ? 300 : opponentRole === 'vanguard' ? 500 : 225;
    const preferredMaximum = opponentRole === 'tank' ? 430 : opponentRole === 'vanguard' ? 600 : 360;
    if (distance > preferredMaximum) command.moveX = direction * 0.58;
    else if (distance < preferredMinimum) command.moveX = -direction * (opponentRole === 'tank' ? 0.9 : 0.72);
    command.moveY = Math.abs(dy) > 80 && dy < 0 ? -1 : 0;
    const projectileChance = opponentRole === 'vanguard' ? 0.28 : opponentRole === 'tank' ? 0.14 : opponentRole === 'rush' ? 0.32 : 0.72;
    if (activeProjectiles < 2 && this.random.chance(projectileChance)) {
      if (distance < 330 && facing !== direction) {
        command.moveX = direction;
        this.queuedNeutralProjectile = true;
        this.trackAction('approach');
        return;
      }
      command.moveX = distance < 330 ? 0 : direction;
      command.moveY = 0;
      command.special = true;
      this.markPulse('special');
    } else {
      this.trackAction(command.moveX === 0 ? 'wait' : command.moveX === direction ? 'approach' : 'retreat');
    }
  }

  private vanguardDecision(
    command: InputCommand,
    distance: number,
    direction: number,
    dy: number,
    opponentRole: ReturnType<typeof getFighter>['role'],
  ): void {
    if (distance > 150) {
      command.moveX = direction * 0.85;
      if (distance > 280 && this.random.chance(0.34)) {
        command.special = true;
        this.markPulse('special');
      } else if (Math.abs(dy) > 80 && this.random.chance(0.2)) {
        command.jump = true;
        this.markPulse('jump');
      } else this.trackAction('approach');
      return;
    }
    if (opponentRole === 'rush' && distance < 112) {
      command.moveX = 0;
      if (this.random.chance(0.62)) {
        command.moveY = 1;
        command.special = true;
        this.markPulse('special');
      } else {
        command.normal = true;
        this.markPulse('normal');
      }
      return;
    }
    command.moveX = direction * 0.5;
    command.moveY = dy < -50 ? -1 : dy > 55 ? 1 : 0;
    const normalChance = opponentRole === 'control' ? 0.68 : opponentRole === 'vanguard' ? 0.72 : 0.74;
    if (this.random.chance(normalChance)) command.normal = true;
    else command.special = true;
    this.markPulse(command.normal ? 'normal' : 'special');
  }

  private markPulse(action: AiAction): void {
    this.pulseRelease = true;
    this.trackAction(action);
  }

  private trackAction(action: AiAction): void {
    if (action === this.previousAction) this.repeatedActions += 1;
    else this.repeatedActions = 0;
    this.previousAction = action;
  }
}

export function createAiControllers(seed: number, difficulty: Difficulty): Record<FighterInstanceId, AiController> {
  const normalizedSeed = Math.trunc(clamp(seed, 1, 0x7fff_ffff));
  return {
    p1: new AiController(normalizedSeed ^ 0x5f3759df, difficulty),
    p2: new AiController(normalizedSeed ^ 0x45d9f3b, difficulty),
  };
}
