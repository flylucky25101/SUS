import type { PlatformDefinition, StageDefinition } from '../core/types';
import { validateStages } from '../core/validation';

export const STAGES: readonly StageDefinition[] = Object.freeze([
  {
    id: 'vector-spire',
    name: { ko: '벡터 첨탑', en: 'Vector Spire' },
    description: { ko: '정교한 대전을 위한 대칭형 공중 조선소', en: 'A symmetrical sky foundry tuned for competition.' },
    competitive: true,
    theme: 'spire',
    platforms: [
      { id: 'main', x: 260, y: 520, width: 760, height: 34, oneWay: false, moving: null },
      { id: 'left-rail', x: 390, y: 390, width: 170, height: 18, oneWay: true, moving: null },
      { id: 'right-rail', x: 720, y: 390, width: 170, height: 18, oneWay: true, moving: null },
    ],
    spawnPoints: [{ x: 465, y: 520 }, { x: 815, y: 520 }],
    respawnPoints: [{ x: 480, y: 220 }, { x: 800, y: 220 }],
    blastZone: { x: 60, y: 20, width: 1160, height: 780 },
  },
  {
    id: 'drift-garden',
    name: { ko: '부유 정원', en: 'Drift Garden' },
    description: { ko: '예고된 이동 발판이 흐르는 네온 생태 정거장', en: 'A neon biome station with clearly telegraphed moving platforms.' },
    competitive: false,
    theme: 'garden',
    platforms: [
      { id: 'main', x: 230, y: 528, width: 820, height: 32, oneWay: false, moving: null },
      { id: 'left-leaf', x: 350, y: 392, width: 170, height: 18, oneWay: true, moving: { axis: 'y', amplitude: 34, periodFrames: 300, phase: 0 } },
      { id: 'right-leaf', x: 760, y: 392, width: 170, height: 18, oneWay: true, moving: { axis: 'y', amplitude: 34, periodFrames: 300, phase: Math.PI } },
      { id: 'seed', x: 570, y: 330, width: 140, height: 16, oneWay: true, moving: { axis: 'x', amplitude: 85, periodFrames: 420, phase: Math.PI / 2 } },
    ],
    spawnPoints: [{ x: 450, y: 528 }, { x: 830, y: 528 }],
    respawnPoints: [{ x: 470, y: 210 }, { x: 810, y: 210 }],
    blastZone: { x: 45, y: 10, width: 1190, height: 800 },
  },
]);

validateStages(STAGES);

export const STAGE_BY_ID: Readonly<Record<StageDefinition['id'], StageDefinition>> = Object.freeze({
  'vector-spire': STAGES[0] as StageDefinition,
  'drift-garden': STAGES[1] as StageDefinition,
});

export function getStage(id: StageDefinition['id']): StageDefinition {
  return STAGE_BY_ID[id];
}

export function platformAtTick(platform: PlatformDefinition, tick: number, hazardsEnabled: boolean): PlatformDefinition {
  if (!hazardsEnabled || platform.moving === null) return platform;
  const movement = platform.moving;
  const wave = Math.sin((tick / movement.periodFrames) * Math.PI * 2 + movement.phase) * movement.amplitude;
  return {
    ...platform,
    x: platform.x + (movement.axis === 'x' ? wave : 0),
    y: platform.y + (movement.axis === 'y' ? wave : 0),
  };
}
