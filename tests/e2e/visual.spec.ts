import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { forceResult, gotoMain, installStableSettings, startQuickMatch } from './helpers';

const SCREENSHOT_DIR = resolve('artifacts/screenshots');

test.beforeAll(() => mkdirSync(SCREENSHOT_DIR, { recursive: true }));
test.beforeEach(async ({ page }) => installStableSettings(page));

test('captures required visual QA surfaces', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (project === 'galaxy-s23-landscape') {
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
    await page.getByTestId('stage-vector-spire').click();
    await page.locator('[data-action="stages-next"]').click();
    await page.locator('[data-action="begin-match"]').click();
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'combat.png') });
    await page.waitForFunction(() => document.querySelector('[data-game-shell]')?.hasAttribute('data-impact') === true, undefined, { timeout: 20_000 });
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'combat-impact.png') });
    await page.keyboard.press('Escape');
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
  }
});
