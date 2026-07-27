import { expect, test } from '@playwright/test';
import { expectNoBrowserIssues, gotoMain, installStableSettings, observeBrowserIssues, startQuickMatch } from './helpers';

test.beforeEach(async ({ page }) => installStableSettings(page));

test('keeps primary menu controls inside every configured viewport', async ({ page }) => {
  const issues = observeBrowserIssues(page);
  await gotoMain(page);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('Viewport is unavailable.');
  const buttons = page.locator('.menu-tile');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).scrollIntoViewIfNeeded();
    const box = await buttons.nth(index).boundingBox();
    expect(box, `menu tile ${index} should have a box`).not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expectNoBrowserIssues(issues);
});

test('keeps landscape HUD separate from touch action controls', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('landscape'));
  const issues = observeBrowserIssues(page);
  await gotoMain(page);
  await startQuickMatch(page);
  const hud = await page.locator('.combat-hud').boundingBox();
  const controls = await page.locator('.action-cluster').boundingBox();
  expect(hud).not.toBeNull();
  expect(controls).not.toBeNull();
  if (hud !== null && controls !== null) expect(hud.y + hud.height).toBeLessThan(controls.y + 4);
  const actionButtons = page.locator('.control-button');
  for (let index = 0; index < await actionButtons.count(); index += 1) {
    const box = await actionButtons.nth(index).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(54);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(54);
  }
  await expectNoBrowserIssues(issues);
});

test('keeps every fighter name inside its selection card', async ({ page }) => {
  const issues = observeBrowserIssues(page);
  await gotoMain(page);
  await page.locator('[data-action="quick"]').click();
  const cards = page.locator('.fighter-card');
  await expect(cards).toHaveCount(6);
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const cardBox = await card.boundingBox();
    const nameBox = await card.locator('.fighter-info > strong').boundingBox();
    expect(cardBox, `fighter card ${index} should have a box`).not.toBeNull();
    expect(nameBox, `fighter name ${index} should have a box`).not.toBeNull();
    if (cardBox !== null && nameBox !== null) {
      expect(nameBox.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
    }
  }
  await expectNoBrowserIssues(issues);
});
