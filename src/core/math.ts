import { GAME_CONFIG } from './config';
import type { Rect, Vec2 } from './types';

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function magnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector: Vec2): Vec2 {
  const length = magnitude(vector);
  if (length < 0.0001 || !Number.isFinite(length)) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

export function angleToVector(angleDegrees: number, facing: -1 | 1): Vec2 {
  const safeAngle = safeNumber(angleDegrees, 45);
  const radians = (safeAngle * Math.PI) / 180;
  return {
    x: Math.cos(radians) * facing,
    y: -Math.sin(radians),
  };
}

export interface KnockbackInput {
  accumulatedDamage: number;
  attackDamage: number;
  baseKnockback: number;
  knockbackGrowth: number;
  defenderWeight: number;
  chargeRatio: number;
  comboHits: number;
}

export function calculateKnockback(input: KnockbackInput): number {
  const damage = clamp(input.accumulatedDamage + input.attackDamage, 0, GAME_CONFIG.maxDamage);
  const weight = clamp(input.defenderWeight, 60, 180);
  const growth = clamp(input.knockbackGrowth, 0, 2.5);
  const charge = 1 + clamp(input.chargeRatio, 0, 1) * 0.32;
  const comboEscape = 1 + Math.max(0, input.comboHits - GAME_CONFIG.comboEscapeAfterHits) * 0.055;
  const raw = (clamp(input.baseKnockback, 0, 20) + growth * damage * 0.075) * (100 / weight) * charge * comboEscape;
  return clamp(raw, 0, GAME_CONFIG.maxKnockback);
}

export function calculateHitstun(baseFrames: number, knockback: number, comboHits: number): number {
  const comboRelief = Math.max(0, comboHits - 3) * 2;
  return Math.round(clamp(baseFrames + knockback * 1.25 - comboRelief, 1, GAME_CONFIG.maxHitstunFrames));
}

export function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function circleIntersectsRect(center: Vec2, radius: number, rect: Rect): boolean {
  const closestX = clamp(center.x, rect.x, rect.x + rect.width);
  const closestY = clamp(center.y, rect.y, rect.y + rect.height);
  const dx = center.x - closestX;
  const dy = center.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    const normalized = Math.trunc(safeNumber(seed, 1)) >>> 0;
    this.state = normalized === 0 ? 0x9e3779b9 : normalized;
  }

  nextUint(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint() / 0x1_0000_0000;
  }

  range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  chance(probability: number): boolean {
    return this.next() < clamp(probability, 0, 1);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('Cannot choose from an empty list.');
    const index = Math.min(values.length - 1, Math.floor(this.next() * values.length));
    const value = values[index];
    if (value === undefined) throw new Error('Seeded choice produced an invalid index.');
    return value;
  }
}
