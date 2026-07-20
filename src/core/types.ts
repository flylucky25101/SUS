export type Language = 'ko' | 'en';
export type FighterId = 'kade' | 'mira' | 'bram' | 'suri';
export type FighterInstanceId = 'p1' | 'p2';
export type FighterRole = 'vanguard' | 'rush' | 'tank' | 'control';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type MatchMode = 'quick' | 'training' | 'debug';
export type FighterStatus =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'charge'
  | 'hurt'
  | 'dodge'
  | 'ko'
  | 'respawn'
  | 'victory';

export interface LocalizedText {
  readonly ko: string;
  readonly en: string;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InputCommand {
  moveX: number;
  moveY: number;
  normal: boolean;
  special: boolean;
  jump: boolean;
  dodge: boolean;
  pause: boolean;
}

export type BufferedAction = 'normal' | 'special' | 'jump' | 'dodge';

export interface ProjectileDefinition {
  speed: number;
  lifetimeFrames: number;
  radius: number;
  maxActive: number;
  gravity: number;
}

export interface MoveDefinition {
  id: string;
  displayName: LocalizedText;
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
  landingLagFrames: number;
  damage: number;
  baseKnockback: number;
  knockbackGrowth: number;
  angle: number;
  hitstun: number;
  hitstop: number;
  range: number;
  hitbox: Rect;
  movementImpulse: Vec2;
  cooldown: number;
  armorFrames: number;
  invulnerabilityFrames: number;
  reflectProjectiles: boolean;
  projectileInvulnerability: boolean;
  cancelRules: readonly BufferedAction[];
  availability: readonly ('ground' | 'air')[];
  visualEffectId: string;
  soundEffectId: string;
  projectile: ProjectileDefinition | null;
}

export interface FighterStats {
  runSpeed: number;
  airSpeed: number;
  acceleration: number;
  airAcceleration: number;
  jumpSpeed: number;
  doubleJumpSpeed: number;
  weight: number;
  maxFallSpeed: number;
  fastFallSpeed: number;
  width: number;
  height: number;
}

export interface FighterDefinition {
  id: FighterId;
  name: string;
  epithet: LocalizedText;
  role: FighterRole;
  description: LocalizedText;
  color: number;
  accent: number;
  pattern: 'chevron' | 'slash' | 'block' | 'orbit';
  budget: {
    mobility: number;
    survivability: number;
    range: number;
    burst: number;
    recovery: number;
    control: number;
  };
  stats: FighterStats;
  moves: Readonly<Record<string, MoveDefinition>>;
}

export interface MovingPlatformDefinition {
  axis: 'x' | 'y';
  amplitude: number;
  periodFrames: number;
  phase: number;
}

export interface PlatformDefinition extends Rect {
  id: string;
  oneWay: boolean;
  moving: MovingPlatformDefinition | null;
}

export interface StageDefinition {
  id: 'vector-spire' | 'drift-garden';
  name: LocalizedText;
  description: LocalizedText;
  competitive: boolean;
  theme: 'spire' | 'garden';
  platforms: readonly PlatformDefinition[];
  spawnPoints: readonly [Vec2, Vec2];
  respawnPoints: readonly [Vec2, Vec2];
  blastZone: Rect;
}

export interface InputMemory {
  previous: InputCommand;
  buffers: Record<BufferedAction, number>;
  coyoteFrames: number;
  chargeFrames: number;
}

export interface AttackState {
  moveId: string;
  frame: number;
  chargeRatio: number;
  hitTargets: FighterInstanceId[];
  projectileSpawned: boolean;
}

export interface FighterState {
  id: FighterInstanceId;
  team: 1 | 2;
  definitionId: FighterId;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
  status: FighterStatus;
  grounded: boolean;
  standingPlatformId: string | null;
  damage: number;
  stocks: number;
  jumpsRemaining: number;
  hitstunFrames: number;
  hitstopFrames: number;
  invulnerabilityFrames: number;
  armorFrames: number;
  dodgeCooldownFrames: number;
  dodgeRepeatWindowFrames: number;
  recoveryUsed: boolean;
  recoveryAttemptActive: boolean;
  landingLagFrames: number;
  dropThroughFrames: number;
  comboHits: number;
  comboDecayFrames: number;
  attack: AttackState | null;
  input: InputMemory;
  lastHitBy: FighterInstanceId | null;
  lastMoveId: string | null;
  moveCooldowns: Record<string, number>;
  totalDamageDealt: number;
  hitsLanded: number;
  recoveriesAttempted: number;
  recoveriesSucceeded: number;
}

export interface ProjectileState {
  id: number;
  ownerId: FighterInstanceId;
  moveId: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  lifetimeFrames: number;
  damage: number;
  baseKnockback: number;
  knockbackGrowth: number;
  angle: number;
  hitstun: number;
  hitstop: number;
  gravity: number;
  hitTargets: FighterInstanceId[];
}

export interface MatchResult {
  winnerId: FighterInstanceId | null;
  reason: 'stocks' | 'time' | 'sudden-death' | 'draw';
  completedAtTick: number;
}

export interface MatchOptions {
  mode: MatchMode;
  stageId: StageDefinition['id'];
  fighterOne: FighterId;
  fighterTwo: FighterId;
  difficulty: Difficulty;
  seed: number;
  hazards: boolean;
}

export interface TrainingOptions {
  behavior: 'stand' | 'move' | 'attack';
  showHitboxes: boolean;
  showFrameData: boolean;
  showInputs: boolean;
}

export interface WorldState {
  tick: number;
  motionTick: number;
  timeFramesRemaining: number;
  suddenDeathFramesRemaining: number;
  inSuddenDeath: boolean;
  paused: boolean;
  ended: boolean;
  result: MatchResult | null;
  options: MatchOptions;
  fighters: [FighterState, FighterState];
  projectiles: ProjectileState[];
  nextProjectileId: number;
  training: TrainingOptions;
}

export type CombatEventType =
  | 'attack-start'
  | 'hit'
  | 'strong-hit'
  | 'jump'
  | 'land'
  | 'dodge'
  | 'projectile'
  | 'ringout'
  | 'respawn'
  | 'match-end';

export interface CombatEvent {
  type: CombatEventType;
  tick: number;
  actorId: FighterInstanceId;
  targetId: FighterInstanceId | null;
  position: Vec2;
  value: number;
  moveId: string | null;
}

export interface StepResult {
  state: WorldState;
  events: CombatEvent[];
}

export const EMPTY_COMMAND: Readonly<InputCommand> = Object.freeze({
  moveX: 0,
  moveY: 0,
  normal: false,
  special: false,
  jump: false,
  dodge: false,
  pause: false,
});
