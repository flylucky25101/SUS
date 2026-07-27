import { expect, test } from '@playwright/test';
import { expectNoBrowserIssues, gotoMain, installStableSettings, observeBrowserIssues } from './helpers';

test.describe('complete illustrated art pass', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'galaxy-s23-landscape', 'Complete art checks use one representative Chromium viewport.');
    await installStableSettings(page);
  });

  test('shows the shop and loads every fighter, stage, and UI artwork', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await page.locator('[data-action="shop"]').click();
    await expect(page.locator('.shop-screen')).toBeVisible();
    await expect(page.locator('.shop-fighter')).toHaveCount(6);
    await expect(page.locator('.shop-stage')).toHaveCount(2);
    await expect(page.locator('.shop-owned')).toHaveCount(8);

    const dimensions = await page.evaluate(async () => {
      const paths = [
        '/assets/fighters/kade-spritesheet.png',
        '/assets/fighters/mira-spritesheet.png',
        '/assets/fighters/bram-spritesheet.png',
        '/assets/fighters/suri-spritesheet.png',
        '/assets/fighters/juno-spritesheet.png',
        '/assets/fighters/orin-spritesheet.png',
        '/assets/portraits/kade-portrait.png',
        '/assets/portraits/mira-portrait.png',
        '/assets/portraits/bram-portrait.png',
        '/assets/portraits/suri-portrait.png',
        '/assets/portraits/juno-portrait.png',
        '/assets/portraits/orin-portrait.png',
        '/assets/stages/vector-spire-bg.webp',
        '/assets/stages/drift-garden-bg.webp',
        '/assets/ui/rift-forge-background.webp',
      ];
      return Promise.all(paths.map((path) => new Promise<{ path: string; width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ path, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error(`Failed to load ${path}`));
        image.src = path;
      })));
    });
    expect(dimensions.slice(0, 6).every(({ width, height }) => width === 512 && height === 384)).toBe(true);
    expect(dimensions.slice(6, 12).every(({ width, height }) => width === 384 && height === 512)).toBe(true);
    expect(dimensions.slice(12).every(({ width, height }) => width === 1280 && height === 720)).toBe(true);
    await expect(page.locator('.shop-fighter').first().locator('.portrait')).toHaveCSS('background-size', 'contain');

    await page.locator('.shop-fighter').first().click();
    await expect(page.locator('[data-toast]')).toHaveClass(/is-visible/);
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.locator('.shop-screen')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoBrowserIssues(issues);
  });

  test('runs JUNO versus ORIN on the fixed initial-release arena', async ({ page }) => {
    const issues = observeBrowserIssues(page);
    await gotoMain(page);
    await page.locator('[data-action="quick"]').click();
    await expect(page.locator('.fighter-card')).toHaveCount(6);
    await expect(page.getByTestId('fighter-juno').locator('strong')).toBeVisible();
    await expect(page.getByTestId('fighter-orin').locator('strong')).toBeVisible();
    await page.getByTestId('fighter-juno').click();
    await expect(page.locator('[data-action="fighters-next"]')).toBeEnabled();
    await expect(page.locator('.fighter-assigned--p1')).toHaveText('P1');
    await expect(page.locator('.fighter-assigned--cpu')).toHaveText('CPU');
    const automaticCpu = await page.locator('.fighter-assigned--cpu').evaluate((badge) => badge.closest<HTMLElement>('[data-value]')?.dataset.value ?? null);
    expect(automaticCpu).not.toBe('juno');
    await page.getByTestId('fighter-orin').click();
    await page.locator('[data-action="fighters-next"]').click();
    await expect(page.locator('.stage-grid')).toHaveCount(0);
    await expect(page.locator('.difficulty-grid')).toBeVisible();
    await page.locator('[data-action="select-difficulty"][data-value="normal"]').click();
    await page.locator('[data-action="begin-match"]').click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__RIFT_DEBUG__?.getState();
      const p1 = window.__RIFT_DEBUG__?.getFighterSpriteSnapshot('p1');
      const p2 = window.__RIFT_DEBUG__?.getFighterSpriteSnapshot('p2');
      return {
        fighters: state?.fighters.map((fighter) => fighter.definitionId) ?? [],
        stage: state?.options.stageId ?? null,
        p1Ready: p1?.ready ?? false,
        p2Ready: p2?.ready ?? false,
        stageReady: window.__RIFT_DEBUG__?.isStageBackgroundReady() ?? false,
      };
    })).toEqual({ fighters: ['juno', 'orin'], stage: 'vector-spire', p1Ready: true, p2Ready: true, stageReady: true });
    await expectNoBrowserIssues(issues);
  });
});
