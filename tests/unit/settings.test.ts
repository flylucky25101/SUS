import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, parseSettings, saveSettings, SETTINGS_STORAGE_KEY } from '../../src/ui/settings';
import { localized } from '../../src/ui/i18n';

describe('settings persistence', () => {
  it('recovers defaults from malformed JSON', () => {
    const storage = { getItem: () => '{broken' };
    expect(loadSettings(storage)).toEqual(defaultSettings());
  });

  it('guards fields and clamps user-controlled ranges', () => {
    const parsed = parseSettings({ version: 1, language: 'xx', stickSize: 999, buttonSize: -4, buttonOpacity: 4 });
    expect(parsed.language).toBe('ko');
    expect(parsed.stickSize).toBe(132);
    expect(parsed.buttonSize).toBe(54);
    expect(parsed.buttonOpacity).toBe(1);
  });

  it('writes the versioned storage key', () => {
    let key = '';
    let value = '';
    saveSettings(defaultSettings('en'), { setItem: (nextKey, nextValue) => { key = nextKey; value = nextValue; } });
    expect(key).toBe(SETTINGS_STORAGE_KEY);
    expect(JSON.parse(value)).toMatchObject({ version: 1, language: 'en' });
  });

  it('falls back to English text when selected text is empty', () => {
    expect(localized('ko', { ko: '', en: 'Fallback' })).toBe('Fallback');
  });
});
