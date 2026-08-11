import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { forceResult, gotoMain, holdTouchPause, installStableSettings, startQuickMatch } from './helpers';

const SCREENSHOT_DIR = resolve('artifacts/screenshots');

test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));
test.beforeEach(async ({ page }) => installStableSettings(page));

test('captures required visual QA surfaces', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (project === 'galaxy-s23-landscape') {
    test.setTimeout(70_000);
    await gotoMain(page);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'galaxy-s23-landscape-main-menu.png') });
    await page.locator('[data-action="shop"]').click();
    await expect(page.locator('.shop-screen')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'shop.png'), fullPage: true });
    await page.locator('[data-action="back-main"]').click();
    await page.locator('[data-action="quick"]').click();
    await expect(page.locator('.fighter-grid')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'character-select.png') });
    await page.getByTestId('fighter-juno').click();
    await page.getByTestId('fighter-orin').click();
    await page.locator('[data-action="fighters-next"]').click();
    await expect(page.locator('.stage-grid')).toHaveCount(0);
    await page.locator('[data-action="begin-match"]').click();
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'combat.png') });
    await page.waitForFunction(() => document.querySelector('[data-game-shell]')?.hasAttribute('data-impact') === true, undefined, { timeout: 20_000 });
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'combat-impact.png') });
    await page.evaluate(() => {
      const state = window.__RIFT_DEBUG__?.getState();
      if (state === null || state === undefined) throw new Error('Projectile showcase requires the combat state.');
      state.paused = true;
      const projectile = (id: number, ownerId: 'p1' | 'p2', moveId: string, x: number, y: number, velocityX: number, radius: number) => ({
        id,
        ownerId,
        moveId,
        position: { x, y },
        velocity: { x: velocityX, y: -0.4 },
        radius,
        lifetimeFrames: 90,
        damage: 8,
        baseKnockback: 4,
        knockbackGrowth: 1,
        angle: 40,
        hitstun: 12,
        hitstop: 4,
        gravity: 0,
        hitTargets: [],
      });
      state.projectiles = [
        projectile(901, 'p1', 'kade.neutral-special', 430, 350, 9.8, 10),
        projectile(902, 'p1', 'suri.neutral-special', 570, 350, 7.7, 13),
        projectile(903, 'p2', 'juno.neutral-special', 710, 350, -11.2, 9),
        projectile(904, 'p2', 'orin.neutral-special', 850, 350, -5.8, 14),
      ];
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'projectile-showcase.png') });
    await page.evaluate(() => {
      const state = window.__RIFT_DEBUG__?.getState();
      if (state === null || state === undefined) return;
      state.projectiles = [];
      state.paused = false;
    });
    await holdTouchPause(page);
    await expect(page.locator('.pause-card')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'pause.png') });
    await page.locator('[data-action="resume"]').click();
    await forceResult(page);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'result.png') });
  } else if (project === 'galaxy-s23-portrait') {
    await page.setViewportSize({ width: 780, height: 360 });
    await gotoMain(page);
    await startQuickMatch(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.locator('html')).toHaveClass(/virtual-landscape/);
    await expect(page.locator('.rotation-gate')).toBeHidden();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'galaxy-s23-portrait-auto-landscape.png') });
  } else if (project === 'narrow-320') {
    await gotoMain(page);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'narrow-320.png'), fullPage: true });
  } else if (project === 'desktop') {
    await gotoMain(page);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'desktop-1280x720.png') });
    await page.locator('[data-action="quick"]').click();
    await expect(page.locator('.fighter-grid')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'desktop-character-select.png') });
    await page.getByTestId('fighter-kade').click();
    await expect(page.locator('.fighter-assigned--cpu')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'desktop-character-select-auto-cpu.png') });
  }
});
