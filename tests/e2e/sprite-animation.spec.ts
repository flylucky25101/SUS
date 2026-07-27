import { expect, test } from '@playwright/test';
import {
  expectNoBrowserIssues,
  gotoMain,
  holdTouchPause,
  installStableSettings,
  observeBrowserIssues,
  startQuickMatch,
  startTraining,
} from './helpers';

test.describe('player sprite animation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'galaxy-s23-landscape', 'Sprite state checks use one representative Chromium viewport.');
    await installStableSettings(page);
  });

  test('maps gameplay states, flips left, locks actions, and holds death', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await startTraining(page);
    await expect(page.locator('[data-countdown]')).toHaveClass(/is-hidden/, { timeout: 12_000 });
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getPlayerSpriteSnapshot() ?? null)).toMatchObject({
      ready: true,
      failed: false,
      name: 'idle',
    });
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getFighterSpriteSnapshot('p2') ?? null)).toMatchObject({
      ready: true,
      failed: false,
    });
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.isStageBackgroundReady() ?? false)).toBe(true);

    await holdTouchPause(page);
    await expect(page.locator('.pause-card')).toBeVisible();
    const setVisualState = async (status: 'idle' | 'run' | 'attack' | 'hurt' | 'ko', velocityX: number, facing: -1 | 1) => {
      await page.evaluate(({ nextStatus, nextVelocityX, nextFacing }) => {
        const fighter = window.__RIFT_DEBUG__?.getState()?.fighters[0];
        if (fighter === undefined) throw new Error('Player fighter state is unavailable.');
        fighter.status = nextStatus;
        fighter.velocity.x = nextVelocityX;
        fighter.facing = nextFacing;
        if (nextStatus === 'hurt') fighter.hitstunFrames = 30;
      }, { nextStatus: status, nextVelocityX: velocityX, nextFacing: facing });
    };
    const snapshot = () => page.evaluate(() => window.__RIFT_DEBUG__?.getPlayerSpriteSnapshot() ?? null);

    await setVisualState('run', 2, 1);
    await expect.poll(snapshot).toMatchObject({ name: 'walk', flipX: false });
    await expect.poll(async () => {
      const frame = (await snapshot())?.frame ?? -1;
      return frame >= 2 && frame <= 5;
    }).toBe(true);
    await setVisualState('run', 2, 1);
    await expect.poll(snapshot).toMatchObject({ name: 'walk', flipX: false });

    await setVisualState('run', 20, -1);
    await expect.poll(snapshot).toMatchObject({ name: 'run', flipX: true });
    await setVisualState('attack', 0, -1);
    await expect.poll(snapshot).toMatchObject({ name: 'attack', flipX: true });
    await page.waitForTimeout(550);
    await expect.poll(snapshot).toMatchObject({ name: 'attack', frame: 5, finished: true });
    await setVisualState('idle', 0, 1);
    await expect.poll(snapshot).toMatchObject({ name: 'idle', flipX: false });

    await setVisualState('hurt', 0, 1);
    await expect.poll(snapshot).toMatchObject({ name: 'hit' });
    await setVisualState('ko', 0, 1);
    await expect.poll(snapshot).toMatchObject({ name: 'death' });
    await page.waitForTimeout(800);
    await expect.poll(snapshot).toMatchObject({ name: 'death', frame: 5, finished: true });
    await setVisualState('idle', 0, 1);
    await page.waitForTimeout(100);
    await expect.poll(snapshot).toMatchObject({ name: 'death', frame: 5, finished: true });
    await expectNoBrowserIssues(issues);
  });

  test('keeps the prototype fallback when the sprite cannot be decoded', async ({ page }) => {
    await page.route('**/assets/fighters/kade-spritesheet.png', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: 'invalid image data' });
    });
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await startQuickMatch(page);
    await expect.poll(async () => page.evaluate(() => window.__RIFT_DEBUG__?.getPlayerSpriteSnapshot() ?? null)).toMatchObject({
      ready: false,
      failed: true,
    });
    await expect(page.locator('canvas')).toBeVisible();
    await expectNoBrowserIssues(issues);
  });
});
