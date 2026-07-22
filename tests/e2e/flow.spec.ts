import { expect, test } from '@playwright/test';
import {
  dispatchPointer,
  expectNoBrowserIssues,
  forceResult,
  gotoMain,
  holdTouchPause,
  installStableSettings,
  observeBrowserIssues,
  startQuickMatch,
  startTraining,
} from './helpers';

test.describe('Galaxy S23 complete flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'galaxy-s23-landscape', 'Complete touch flow targets the Galaxy S23 landscape profile.');
    await installStableSettings(page);
  });

  test('loads, selects content, accepts multitouch, pauses, rotates, and rematches', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await startQuickMatch(page);
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getFighterVisualScale() ?? 1)).toBe(1.75);

    await dispatchPointer(page, '[data-stick-zone]', 'pointerdown', 11, 0.28, 0.62);
    await dispatchPointer(page, '[data-stick-zone]', 'pointermove', 11, 0.7, 0.62);
    await dispatchPointer(page, '[data-control="normal"]', 'pointerdown', 22);
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__RIFT_DEBUG__?.getState();
      return state === null || state === undefined ? null : { moveX: state.fighters[0].input.previous.moveX, normal: state.fighters[0].input.previous.normal };
    })).toMatchObject({ moveX: expect.any(Number), normal: true });
    const simultaneous = await page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.fighters[0].input.previous.moveX ?? 0);
    expect(simultaneous).toBeGreaterThan(0.2);
    await dispatchPointer(page, '[data-control="normal"]', 'pointercancel', 22);
    await dispatchPointer(page, '[data-stick-zone]', 'pointerup', 11, 0.7, 0.62);
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.fighters[0].input.previous.normal ?? true)).toBe(false);
    await dispatchPointer(page, '[data-control="normal"]', 'pointerdown', 23);
    await expect(page.locator('[data-control="normal"]')).toHaveClass(/is-pressed/);
    await page.evaluate(() => window.__RIFT_DEBUG__?.releaseInputs());
    await expect(page.locator('[data-control="normal"]')).not.toHaveClass(/is-pressed/);

    await dispatchPointer(page, '[data-control="jump"]', 'pointerdown', 33);
    await dispatchPointer(page, '[data-control="normal"]', 'pointerdown', 34);
    await page.waitForTimeout(80);
    await dispatchPointer(page, '[data-control="jump"]', 'pointerup', 33);
    await dispatchPointer(page, '[data-control="normal"]', 'pointerup', 34);

    await holdTouchPause(page);
    await expect(page.locator('.pause-card')).toBeVisible();
    const pausedTick = await page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.tick ?? -1);
    await page.waitForTimeout(140);
    expect(await page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.tick ?? -2)).toBe(pausedTick);
    await page.locator('[data-action="resume"]').click();
    await expect(page.locator('.pause-card')).toBeHidden();

    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.locator('html')).toHaveClass(/virtual-landscape/);
    await expect(page.locator('.rotation-gate')).toBeHidden();
    const gameLayout = await page.locator('[data-game-shell]').evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
    expect(gameLayout.width).toBeGreaterThan(gameLayout.height);
    const tickWhileRotated = await page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.tick ?? 0);
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.tick ?? 0)).toBeGreaterThan(tickWhileRotated);

    // iPhone 16 CSS viewport equivalents: portrait fallback and native landscape.
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.locator('html')).toHaveClass(/virtual-landscape/);
    const iphoneLayout = await page.locator('[data-game-shell]').evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
    expect(iphoneLayout).toEqual({ width: 852, height: 393 });
    await page.setViewportSize({ width: 852, height: 393 });
    await expect(page.locator('html')).not.toHaveClass(/virtual-landscape/);
    await expect(page.locator('.rotation-gate')).toBeHidden();
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getFighterVisualScale() ?? 1)).toBe(1.75);

    await holdTouchPause(page);
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getAudioState() ?? 'uninitialized')).toBe('suspended');
    await page.locator('[data-action="restart-match"]').click();
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getAudioState() ?? 'uninitialized')).toBe('running');
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });

    await forceResult(page, 'p1');
    await page.locator('[data-action="rematch"]').click();
    await expect(page.locator('[data-game-shell]')).toBeVisible();
    await forceResult(page, 'p2');
    await page.locator('.result-card [data-action="exit-game"]').click();
    await expect(page.locator('[data-action="quick"]')).toBeVisible();
    await expectNoBrowserIssues(issues);
  });

  test('persists settings, switches language, and exposes training tools', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await page.locator('[data-action="open-settings"]').click();
    await page.locator('input[data-setting="buttonSize"]').fill('68');
    await page.locator('[data-action="toggle-setting"][data-value="leftHanded"]').click();
    await page.locator('[data-action="set-language"][data-value="en"]').click();
    await expect(page.locator('.back-button')).toHaveAttribute('aria-label', 'BACK');
    await page.reload();
    await expect(page.locator('[data-action="enter-main"]')).toBeVisible();
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('rift-forge.settings.v1') ?? '{}') as { buttonSize?: number; leftHanded?: boolean; language?: string });
    expect(persisted).toMatchObject({ buttonSize: 68, leftHanded: true, language: 'en' });

    await page.locator('[data-action="enter-main"]').click();
    await page.locator('[data-action="quick"]').click();
    await expect(page.getByTestId('fighter-kade')).toBeVisible();
    await page.locator('[data-action="open-settings"]').click();
    await page.locator('[data-action="back-settings-origin"]').click();
    await expect(page.getByTestId('fighter-kade')).toBeVisible();
    await page.locator('[data-action="back-main"]').click();
    await startTraining(page);
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });
    await holdTouchPause(page);
    await page.locator('[data-action="open-settings-pause"]').click();
    await page.locator('[data-action="set-language"][data-value="ko"]').click();
    await expect(page.locator('[data-touch-root]')).toHaveAttribute('aria-label', '터치');
    await expect(page.locator('[data-rotate-title]')).toHaveText('기기를 가로로 돌려주세요');
    await expect(page.locator('.settings-modal h1')).toHaveText('설정');
    await page.locator('[data-action="set-language"][data-value="en"]').click();
    await page.locator('[data-action="close-game-settings"]').click();
    await page.locator('[data-action="resume"]').click();
    await page.locator('[data-action="training-behavior"][data-value="attack"]').click();
    await expect.poll(async () => page.evaluate(() => {
      const fighter = window.__RIFT_DEBUG__?.getState()?.fighters[1];
      return fighter?.attack?.moveId ?? fighter?.lastMoveId ?? null;
    }), { timeout: 4_000 }).not.toBeNull();
    await page.locator('[data-action="training-toggle"][data-value="showHitboxes"]').click();
    await page.locator('[data-action="training-toggle"][data-value="showFrameData"]').click();
    await page.locator('[data-action="training-toggle"][data-value="showInputs"]').click();
    await expect(page.locator('[data-frame-data]')).toHaveClass(/is-visible/);
    await expect(page.locator('[data-hud-stock-label]')).toContainText('∞');
    await expect(page.locator('[data-hud-timer]')).toHaveText('∞');
    await page.locator('[data-action="training-reset-damage"]').click();
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getState()?.fighters.every((fighter) => fighter.damage === 0) ?? false)).toBe(true);
    await page.evaluate(() => {
      const fighter = window.__RIFT_DEBUG__?.getState()?.fighters[0];
      if (fighter === undefined) return;
      fighter.damage = 73;
      fighter.totalDamageDealt = 42;
      fighter.hitsLanded = 3;
      fighter.position.x = 999;
    });
    await page.locator('[data-action="training-reset-position"]').click();
    await expect.poll(async () => page.evaluate(() => {
      const fighter = window.__RIFT_DEBUG__?.getState()?.fighters[0];
      return fighter === undefined ? null : {
        damage: fighter.damage,
        damageDealt: fighter.totalDamageDealt,
        hits: fighter.hitsLanded,
        x: fighter.position.x,
      };
    })).toEqual({ damage: 73, damageDealt: 42, hits: 3, x: 465 });
    await expectNoBrowserIssues(issues);
  });

  test('opens the seeded AI Lab and changes simulation speed', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await page.locator('[data-action="debug"]').click();
    await expect(page.locator('.debug-panel')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__RIFT_DEBUG__?.getState();
      return state === null || state === undefined ? null : { mode: state.options.mode, seed: state.options.seed };
    })).toEqual({ mode: 'debug', seed: 1337 });
    await page.locator('[data-action="debug-speed"][data-value="4"]').click();
    await expect(page.locator('[data-action="debug-speed"][data-value="4"]')).toHaveClass(/active/);
    await expectNoBrowserIssues(issues);
  });
});
