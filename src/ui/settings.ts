import { clamp } from '../core/math';
import type { Language } from '../core/types';

export interface GameSettings {
  version: 1;
  language: Language;
  stickSize: number;
  buttonSize: number;
  buttonOpacity: number;
  leftHanded: boolean;
  floatingStick: boolean;
  haptics: boolean;
  screenShake: boolean;
  reducedMotion: boolean;
  sfxVolume: number;
  musicVolume: number;
  hazards: boolean;
  onboardingSeen: boolean;
}

export const SETTINGS_STORAGE_KEY = 'rift-forge.settings.v1';

function browserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'ko';
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function defaultSettings(language: Language = browserLanguage()): GameSettings {
  return {
    version: 1,
    language,
    stickSize: 104,
    buttonSize: 62,
    buttonOpacity: 0.82,
    leftHanded: false,
    floatingStick: true,
    haptics: true,
    screenShake: true,
    reducedMotion: false,
    sfxVolume: 0.72,
    musicVolume: 0.34,
    hazards: true,
    onboardingSeen: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberOr(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

export function parseSettings(value: unknown, fallback = defaultSettings()): GameSettings {
  if (!isRecord(value) || value.version !== 1) return { ...fallback };
  return {
    version: 1,
    language: value.language === 'ko' || value.language === 'en' ? value.language : fallback.language,
    stickSize: numberOr(value.stickSize, fallback.stickSize, 84, 132),
    buttonSize: numberOr(value.buttonSize, fallback.buttonSize, 54, 72),
    buttonOpacity: numberOr(value.buttonOpacity, fallback.buttonOpacity, 0.45, 1),
    leftHanded: booleanOr(value.leftHanded, fallback.leftHanded),
    floatingStick: booleanOr(value.floatingStick, fallback.floatingStick),
    haptics: booleanOr(value.haptics, fallback.haptics),
    screenShake: booleanOr(value.screenShake, fallback.screenShake),
    reducedMotion: booleanOr(value.reducedMotion, fallback.reducedMotion),
    sfxVolume: numberOr(value.sfxVolume, fallback.sfxVolume, 0, 1),
    musicVolume: numberOr(value.musicVolume, fallback.musicVolume, 0, 1),
    hazards: booleanOr(value.hazards, fallback.hazards),
    onboardingSeen: booleanOr(value.onboardingSeen, fallback.onboardingSeen),
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): GameSettings {
  const fallback = defaultSettings();
  if (storage === null) return fallback;
  const raw = storage.getItem(SETTINGS_STORAGE_KEY);
  if (raw === null) return fallback;
  try {
    return parseSettings(JSON.parse(raw), fallback);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

export function saveSettings(settings: GameSettings, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  if (storage !== null) storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function applySettingsCss(settings: GameSettings, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--stick-size', `${settings.stickSize}px`);
  root.style.setProperty('--button-size', `${settings.buttonSize}px`);
  root.style.setProperty('--control-opacity', String(settings.buttonOpacity));
  root.dataset.handed = settings.leftHanded ? 'left' : 'right';
  root.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
}
