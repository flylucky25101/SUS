import type { FighterDefinition, MoveDefinition, ProjectileDefinition, Rect, Vec2 } from '../core/types';
import { validateFighters } from '../core/validation';

interface MoveTuning {
  startup: number;
  active: number;
  recovery: number;
  landingLag: number;
  damage: number;
  baseKnockback: number;
  growth: number;
  angle: number;
  hitstun: number;
  hitstop: number;
  range: number;
  hitbox: Rect;
  impulse?: Vec2;
  cooldown?: number;
  armor?: number;
  invulnerability?: number;
  reflectProjectiles?: boolean;
  projectileInvulnerability?: boolean;
  cancel?: MoveDefinition['cancelRules'];
  availability?: MoveDefinition['availability'];
  effect?: string;
  sound?: string;
  projectile?: ProjectileDefinition;
}

function move(owner: string, key: string, ko: string, en: string, tuning: MoveTuning): MoveDefinition {
  return {
    id: `${owner}.${key}`,
    displayName: { ko, en },
    startupFrames: tuning.startup,
    activeFrames: tuning.active,
    recoveryFrames: tuning.recovery,
    landingLagFrames: tuning.landingLag,
    damage: tuning.damage,
    baseKnockback: tuning.baseKnockback,
    knockbackGrowth: tuning.growth,
    angle: tuning.angle,
    hitstun: tuning.hitstun,
    hitstop: tuning.hitstop,
    range: tuning.range,
    hitbox: tuning.hitbox,
    movementImpulse: tuning.impulse ?? { x: 0, y: 0 },
    cooldown: tuning.cooldown ?? 0,
    armorFrames: tuning.armor ?? 0,
    invulnerabilityFrames: tuning.invulnerability ?? 0,
    reflectProjectiles: tuning.reflectProjectiles ?? false,
    projectileInvulnerability: tuning.projectileInvulnerability ?? false,
    cancelRules: tuning.cancel ?? [],
    availability: tuning.availability ?? ['ground'],
    visualEffectId: tuning.effect ?? 'arc',
    soundEffectId: tuning.sound ?? 'swing',
    projectile: tuning.projectile ?? null,
  };
}

const kadeMoves: Readonly<Record<string, MoveDefinition>> = Object.freeze({
  jab: move('kade', 'jab', '프리즘 연타', 'Prism Chain', {
    startup: 4, active: 3, recovery: 8, landingLag: 6, damage: 4.2, baseKnockback: 2.4, growth: 0.72,
    angle: 26, hitstun: 8, hitstop: 3, range: 55, hitbox: { x: 20, y: -42, width: 52, height: 34 }, cancel: ['normal'],
  }),
  sideNormal: move('kade', 'side-normal', '벡터 베기', 'Vector Cut', {
    startup: 8, active: 4, recovery: 15, landingLag: 8, damage: 9.5, baseKnockback: 4.1, growth: 1.02,
    angle: 34, hitstun: 13, hitstop: 5, range: 86, hitbox: { x: 22, y: -56, width: 78, height: 46 }, effect: 'cyan-slash',
  }),
  upNormal: move('kade', 'up-normal', '상승 호', 'Rising Arc', {
    startup: 7, active: 5, recovery: 14, landingLag: 7, damage: 8.2, baseKnockback: 3.7, growth: 0.96,
    angle: 82, hitstun: 12, hitstop: 4, range: 68, hitbox: { x: -32, y: -96, width: 64, height: 66 }, effect: 'cyan-arc',
  }),
  downNormal: move('kade', 'down-normal', '저층 파동', 'Low Pulse', {
    startup: 6, active: 4, recovery: 13, landingLag: 6, damage: 7.4, baseKnockback: 3.1, growth: 0.82,
    angle: 24, hitstun: 11, hitstop: 4, range: 70, hitbox: { x: 16, y: -22, width: 70, height: 24 }, effect: 'ground-wave',
  }),
  neutralSpecial: move('kade', 'neutral-special', '플럭스 못', 'Flux Pin', {
    startup: 14, active: 2, recovery: 20, landingLag: 12, damage: 7.8, baseKnockback: 3.6, growth: 0.9,
    angle: 38, hitstun: 12, hitstop: 4, range: 210, hitbox: { x: 28, y: -48, width: 20, height: 20 }, effect: 'cyan-bolt', sound: 'special',
    availability: ['ground', 'air'], projectile: { speed: 9.8, lifetimeFrames: 54, radius: 10, maxActive: 1, gravity: 0 },
  }),
  sideSpecial: move('kade', 'side-special', '위상 돌진', 'Phase Drive', {
    startup: 10, active: 6, recovery: 22, landingLag: 13, damage: 11, baseKnockback: 4.8, growth: 1.08,
    angle: 30, hitstun: 15, hitstop: 6, range: 90, hitbox: { x: 16, y: -58, width: 72, height: 58 }, impulse: { x: 8.5, y: -1 }, projectileInvulnerability: true, effect: 'cyan-trail', sound: 'special', availability: ['ground', 'air'],
  }),
  upSpecial: move('kade', 'up-special', '축광 도약', 'Lumen Ascent', {
    startup: 8, active: 7, recovery: 26, landingLag: 17, damage: 8.7, baseKnockback: 3.4, growth: 0.86,
    angle: 78, hitstun: 11, hitstop: 4, range: 68, hitbox: { x: -26, y: -88, width: 52, height: 78 }, impulse: { x: 2.4, y: -14.8 }, effect: 'cyan-column', sound: 'special', availability: ['ground', 'air'],
  }),
  downSpecial: move('kade', 'down-special', '굴절막', 'Refraction Guard', {
    startup: 5, active: 9, recovery: 24, landingLag: 14, damage: 6.1, baseKnockback: 4.7, growth: 0.78,
    angle: 55, hitstun: 10, hitstop: 5, range: 56, hitbox: { x: -28, y: -68, width: 56, height: 62 }, invulnerability: 7, reflectProjectiles: true, effect: 'cyan-shield', sound: 'dodge', availability: ['ground', 'air'],
  }),
  airNormal: move('kade', 'air-normal', '궤도 회전', 'Orbit Sweep', {
    startup: 6, active: 8, recovery: 16, landingLag: 11, damage: 7.8, baseKnockback: 3.5, growth: 0.9,
    angle: 48, hitstun: 11, hitstop: 4, range: 70, hitbox: { x: -40, y: -62, width: 80, height: 62 }, effect: 'cyan-ring', availability: ['air'],
  }),
});

const miraMoves: Readonly<Record<string, MoveDefinition>> = Object.freeze({
  jab: move('mira', 'jab', '스파크 러시', 'Spark Rush', {
    startup: 2, active: 2, recovery: 6, landingLag: 5, damage: 3.1, baseKnockback: 1.7, growth: 0.56,
    angle: 20, hitstun: 6, hitstop: 2, range: 43, hitbox: { x: 18, y: -42, width: 42, height: 30 }, cancel: ['normal'], effect: 'magenta-streak',
  }),
  sideNormal: move('mira', 'side-normal', '블링크 칼날', 'Blink Edge', {
    startup: 5, active: 3, recovery: 13, landingLag: 7, damage: 7.8, baseKnockback: 3.1, growth: 0.92,
    angle: 28, hitstun: 10, hitstop: 4, range: 62, hitbox: { x: 20, y: -48, width: 58, height: 36 }, impulse: { x: 2.8, y: 0 }, effect: 'magenta-slash',
  }),
  upNormal: move('mira', 'up-normal', '니들 킥', 'Needle Kick', {
    startup: 4, active: 4, recovery: 12, landingLag: 7, damage: 6.5, baseKnockback: 2.8, growth: 0.86,
    angle: 88, hitstun: 9, hitstop: 3, range: 55, hitbox: { x: -22, y: -90, width: 48, height: 62 }, effect: 'magenta-arc',
  }),
  downNormal: move('mira', 'down-normal', '슬라이드 절단', 'Slide Cut', {
    startup: 4, active: 5, recovery: 16, landingLag: 7, damage: 7, baseKnockback: 2.7, growth: 0.8,
    angle: 18, hitstun: 10, hitstop: 3, range: 65, hitbox: { x: 18, y: -20, width: 64, height: 22 }, impulse: { x: 3.6, y: 0 }, effect: 'magenta-low',
  }),
  neutralSpecial: move('mira', 'neutral-special', '잔광 표식', 'Afterglow Mark', {
    startup: 10, active: 4, recovery: 18, landingLag: 10, damage: 7.2, baseKnockback: 3.2, growth: 0.76,
    angle: 42, hitstun: 13, hitstop: 4, range: 80, hitbox: { x: 20, y: -62, width: 74, height: 54 }, effect: 'magenta-cross', sound: 'special', availability: ['ground', 'air'],
  }),
  sideSpecial: move('mira', 'side-special', '레이저 스텝', 'Razor Step', {
    startup: 6, active: 5, recovery: 23, landingLag: 13, damage: 9.6, baseKnockback: 3.8, growth: 0.94,
    angle: 31, hitstun: 12, hitstop: 5, range: 82, hitbox: { x: 14, y: -52, width: 70, height: 45 }, impulse: { x: 11.2, y: -0.8 }, effect: 'magenta-trail', sound: 'special', availability: ['ground', 'air'],
  }),
  upSpecial: move('mira', 'up-special', '펄스 볼트', 'Pulse Vault', {
    startup: 5, active: 5, recovery: 26, landingLag: 18, damage: 6.8, baseKnockback: 2.9, growth: 0.78,
    angle: 76, hitstun: 9, hitstop: 3, range: 50, hitbox: { x: -24, y: -78, width: 48, height: 64 }, impulse: { x: 3.8, y: -16.5 }, effect: 'magenta-vault', sound: 'special', availability: ['ground', 'air'],
  }),
  downSpecial: move('mira', 'down-special', '역상 전환', 'Reverse Phase', {
    startup: 4, active: 8, recovery: 28, landingLag: 15, damage: 5.8, baseKnockback: 3.9, growth: 0.74,
    angle: 62, hitstun: 8, hitstop: 4, range: 48, hitbox: { x: -24, y: -58, width: 48, height: 52 }, invulnerability: 6, impulse: { x: -4.5, y: -3 }, effect: 'magenta-fade', sound: 'dodge', availability: ['ground', 'air'],
  }),
  airNormal: move('mira', 'air-normal', '쌍궤 베기', 'Twin Orbit', {
    startup: 3, active: 7, recovery: 14, landingLag: 10, damage: 6.2, baseKnockback: 2.5, growth: 0.8,
    angle: 46, hitstun: 9, hitstop: 3, range: 60, hitbox: { x: -32, y: -58, width: 68, height: 56 }, effect: 'magenta-ring', availability: ['air'],
  }),
});

const bramMoves: Readonly<Record<string, MoveDefinition>> = Object.freeze({
  jab: move('bram', 'jab', '리벳 타격', 'Rivet Blow', {
    startup: 6, active: 4, recovery: 11, landingLag: 8, damage: 5.8, baseKnockback: 3.2, growth: 0.74,
    angle: 24, hitstun: 10, hitstop: 4, range: 52, hitbox: { x: 24, y: -48, width: 50, height: 42 }, cancel: ['normal'], effect: 'amber-smash',
  }),
  sideNormal: move('bram', 'side-normal', '용광로 추', 'Furnace Maul', {
    startup: 15, active: 5, recovery: 28, landingLag: 15, damage: 14.6, baseKnockback: 5.8, growth: 1.18,
    angle: 35, hitstun: 19, hitstop: 8, range: 96, hitbox: { x: 22, y: -66, width: 92, height: 62 }, armor: 6, effect: 'amber-crush', sound: 'heavy',
  }),
  upNormal: move('bram', 'up-normal', '대들보 올리기', 'Girder Lift', {
    startup: 11, active: 6, recovery: 23, landingLag: 13, damage: 12.6, baseKnockback: 5.2, growth: 1.1,
    angle: 84, hitstun: 17, hitstop: 7, range: 82, hitbox: { x: -40, y: -108, width: 82, height: 82 }, armor: 3, effect: 'amber-arc', sound: 'heavy',
  }),
  downNormal: move('bram', 'down-normal', '기초 파쇄', 'Foundation Break', {
    startup: 10, active: 5, recovery: 22, landingLag: 12, damage: 12.2, baseKnockback: 5.6, growth: 1.04,
    angle: 26, hitstun: 16, hitstop: 7, range: 88, hitbox: { x: 18, y: -28, width: 86, height: 30 }, effect: 'amber-quake', sound: 'heavy',
  }),
  neutralSpecial: move('bram', 'neutral-special', '압력 코어', 'Pressure Core', {
    startup: 18, active: 7, recovery: 27, landingLag: 16, damage: 14, baseKnockback: 6.5, growth: 1.15,
    angle: 45, hitstun: 18, hitstop: 8, range: 78, hitbox: { x: 14, y: -74, width: 74, height: 70 }, armor: 10, effect: 'amber-core', sound: 'special', availability: ['ground', 'air'],
  }),
  sideSpecial: move('bram', 'side-special', '철벽 진군', 'Bulwark March', {
    startup: 12, active: 10, recovery: 31, landingLag: 17, damage: 13.2, baseKnockback: 5.8, growth: 1.08,
    angle: 30, hitstun: 17, hitstop: 7, range: 82, hitbox: { x: 20, y: -72, width: 76, height: 68 }, impulse: { x: 6.4, y: 0 }, armor: 8, effect: 'amber-trail', sound: 'heavy', availability: ['ground', 'air'],
  }),
  upSpecial: move('bram', 'up-special', '슬래그 분출', 'Slag Eruption', {
    startup: 13, active: 8, recovery: 35, landingLag: 22, damage: 10.4, baseKnockback: 4.5, growth: 0.96,
    angle: 80, hitstun: 14, hitstop: 6, range: 70, hitbox: { x: -34, y: -94, width: 68, height: 86 }, impulse: { x: 1.6, y: -12.2 }, armor: 5, effect: 'amber-eruption', sound: 'special', availability: ['ground', 'air'],
  }),
  downSpecial: move('bram', 'down-special', '앵커 스탠스', 'Anchor Stance', {
    startup: 9, active: 14, recovery: 30, landingLag: 18, damage: 9.5, baseKnockback: 6.7, growth: 0.9,
    angle: 58, hitstun: 15, hitstop: 7, range: 60, hitbox: { x: -30, y: -68, width: 60, height: 62 }, armor: 14, effect: 'amber-guard', sound: 'special', availability: ['ground', 'air'],
  }),
  airNormal: move('bram', 'air-normal', '주조 낙하', 'Foundry Drop', {
    startup: 10, active: 9, recovery: 25, landingLag: 20, damage: 12.1, baseKnockback: 5.4, growth: 1.02,
    angle: -68, hitstun: 15, hitstop: 7, range: 70, hitbox: { x: -36, y: -16, width: 72, height: 70 }, impulse: { x: 0, y: 3.2 }, effect: 'amber-drop', sound: 'heavy', availability: ['air'],
  }),
});

const suriMoves: Readonly<Record<string, MoveDefinition>> = Object.freeze({
  jab: move('suri', 'jab', '궤도 밀치기', 'Orbit Tap', {
    startup: 5, active: 3, recovery: 10, landingLag: 7, damage: 3.8, baseKnockback: 2.2, growth: 0.62,
    angle: 25, hitstun: 8, hitstop: 3, range: 48, hitbox: { x: 20, y: -45, width: 46, height: 34 }, cancel: ['normal'], effect: 'violet-tap',
  }),
  sideNormal: move('suri', 'side-normal', '위성 채찍', 'Satellite Lash', {
    startup: 8, active: 5, recovery: 17, landingLag: 10, damage: 9.2, baseKnockback: 4.1, growth: 0.98,
    angle: 32, hitstun: 12, hitstop: 5, range: 98, hitbox: { x: 24, y: -58, width: 94, height: 44 }, effect: 'violet-lash',
  }),
  upNormal: move('suri', 'up-normal', '천정 렌즈', 'Zenith Lens', {
    startup: 8, active: 5, recovery: 17, landingLag: 10, damage: 7.7, baseKnockback: 3.5, growth: 0.9,
    angle: 88, hitstun: 11, hitstop: 4, range: 78, hitbox: { x: -34, y: -106, width: 68, height: 76 }, effect: 'violet-lens',
  }),
  downNormal: move('suri', 'down-normal', '중력 고리', 'Gravity Ring', {
    startup: 10, active: 6, recovery: 20, landingLag: 11, damage: 7.2, baseKnockback: 3.4, growth: 0.78,
    angle: 68, hitstun: 14, hitstop: 4, range: 72, hitbox: { x: -38, y: -28, width: 76, height: 30 }, effect: 'violet-ring',
  }),
  neutralSpecial: move('suri', 'neutral-special', '혜성 씨앗', 'Comet Seed', {
    startup: 15, active: 2, recovery: 22, landingLag: 14, damage: 9.6, baseKnockback: 4.5, growth: 1.1,
    angle: 40, hitstun: 14, hitstop: 5, range: 360, hitbox: { x: 24, y: -52, width: 24, height: 24 }, effect: 'violet-comet', sound: 'special',
    availability: ['ground', 'air'], projectile: { speed: 7.7, lifetimeFrames: 92, radius: 13, maxActive: 2, gravity: 0.02 },
  }),
  sideSpecial: move('suri', 'side-special', '분광 궤도', 'Prism Orbit', {
    startup: 20, active: 3, recovery: 27, landingLag: 16, damage: 11.2, baseKnockback: 5.1, growth: 1.15,
    angle: 36, hitstun: 16, hitstop: 6, range: 420, hitbox: { x: 26, y: -50, width: 26, height: 26 }, cooldown: 70, effect: 'violet-orbit', sound: 'special',
    availability: ['ground', 'air'], projectile: { speed: 6, lifetimeFrames: 110, radius: 16, maxActive: 1, gravity: 0 },
  }),
  upSpecial: move('suri', 'up-special', '궤도 견인', 'Orbital Tether', {
    startup: 9, active: 6, recovery: 29, landingLag: 18, damage: 7.2, baseKnockback: 3.3, growth: 0.82,
    angle: 82, hitstun: 10, hitstop: 4, range: 60, hitbox: { x: -28, y: -88, width: 56, height: 72 }, impulse: { x: 2.4, y: -15.8 }, effect: 'violet-tether', sound: 'special', availability: ['ground', 'air'],
  }),
  downSpecial: move('suri', 'down-special', '공백 도약', 'Null Skip', {
    startup: 5, active: 7, recovery: 30, landingLag: 15, damage: 5.2, baseKnockback: 3.2, growth: 0.74,
    angle: 60, hitstun: 9, hitstop: 3, range: 48, hitbox: { x: -24, y: -58, width: 48, height: 52 }, invulnerability: 9, impulse: { x: -7.2, y: -2.4 }, cooldown: 58, effect: 'violet-skip', sound: 'dodge', availability: ['ground', 'air'],
  }),
  airNormal: move('suri', 'air-normal', '성운 부채', 'Nebula Fan', {
    startup: 7, active: 7, recovery: 19, landingLag: 13, damage: 7.1, baseKnockback: 3.2, growth: 0.84,
    angle: 50, hitstun: 10, hitstop: 4, range: 76, hitbox: { x: -34, y: -66, width: 78, height: 62 }, effect: 'violet-fan', availability: ['air'],
  }),
});

export const FIGHTERS: readonly FighterDefinition[] = Object.freeze([
  {
    id: 'kade', name: 'KADE', epithet: { ko: '플럭스 수호자', en: 'Flux Warden' }, role: 'vanguard',
    description: { ko: '안정적인 사거리와 복귀를 갖춘 균형형 전사', en: 'A balanced fighter with dependable reach and recovery.' },
    color: 0x35d9ff, accent: 0xd8f8ff, pattern: 'chevron',
    budget: { mobility: 6, survivability: 6, range: 6, burst: 6, recovery: 6, control: 6 },
    stats: { runSpeed: 6.1, airSpeed: 5.2, acceleration: 1.05, airAcceleration: 0.46, jumpSpeed: 13.4, doubleJumpSpeed: 12.3, weight: 102, maxFallSpeed: 16, fastFallSpeed: 21, width: 50, height: 86 },
    moves: kadeMoves,
  },
  {
    id: 'mira', name: 'MIRA', epithet: { ko: '펄스 러너', en: 'Pulse Runner' }, role: 'rush',
    description: { ko: '빠른 접근과 연속 압박에 특화된 경량 전사', en: 'A lightweight duelist built for rapid pressure.' },
    color: 0xff3f9d, accent: 0xffd4eb, pattern: 'slash',
    budget: { mobility: 9, survivability: 4, range: 4, burst: 7, recovery: 8, control: 4 },
    stats: { runSpeed: 8.2, airSpeed: 6.7, acceleration: 1.38, airAcceleration: 0.62, jumpSpeed: 14.2, doubleJumpSpeed: 13.5, weight: 82, maxFallSpeed: 17, fastFallSpeed: 23, width: 44, height: 78 },
    moves: miraMoves,
  },
  {
    id: 'bram', name: 'BRAM', epithet: { ko: '주조 요새', en: 'Forge Bastion' }, role: 'tank',
    description: { ko: '느리지만 강력한 갑주와 단발 화력을 지닌 중량 전사', en: 'A massive bruiser with armor and punishing single hits.' },
    color: 0xffb23f, accent: 0xffedbe, pattern: 'block',
    budget: { mobility: 3, survivability: 9, range: 7, burst: 9, recovery: 3, control: 5 },
    stats: { runSpeed: 4.1, airSpeed: 3.7, acceleration: 0.76, airAcceleration: 0.31, jumpSpeed: 11.4, doubleJumpSpeed: 10.3, weight: 138, maxFallSpeed: 18, fastFallSpeed: 22, width: 66, height: 94 },
    moves: bramMoves,
  },
  {
    id: 'suri', name: 'SURI', epithet: { ko: '궤도 직조자', en: 'Orbit Weaver' }, role: 'control',
    description: { ko: '위성과 발사체로 중장거리를 설계하는 전술가', en: 'A tactician who shapes space with satellites and bolts.' },
    color: 0xa66bff, accent: 0xeee0ff, pattern: 'orbit',
    budget: { mobility: 5, survivability: 4, range: 9, burst: 5, recovery: 6, control: 7 },
    stats: { runSpeed: 5.8, airSpeed: 5.5, acceleration: 1, airAcceleration: 0.52, jumpSpeed: 13.2, doubleJumpSpeed: 12.7, weight: 90, maxFallSpeed: 15, fastFallSpeed: 20, width: 48, height: 82 },
    moves: suriMoves,
  },
]);

validateFighters(FIGHTERS);

export const FIGHTER_BY_ID: Readonly<Record<FighterDefinition['id'], FighterDefinition>> = Object.freeze({
  kade: FIGHTERS[0] as FighterDefinition,
  mira: FIGHTERS[1] as FighterDefinition,
  bram: FIGHTERS[2] as FighterDefinition,
  suri: FIGHTERS[3] as FighterDefinition,
});

export function getFighter(id: FighterDefinition['id']): FighterDefinition {
  return FIGHTER_BY_ID[id];
}
