import { expect, type Page } from '@playwright/test';

export interface BrowserIssueLog {
  consoleErrors: string[];
  pageErrors: string[];
}

export async function installStableSettings(page: Page, language: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.addInitScript(({ selectedLanguage }) => {
    if (localStorage.getItem('rift-forge.settings.v1') !== null) return;
    localStorage.setItem('rift-forge.settings.v1', JSON.stringify({
      version: 1,
      language: selectedLanguage,
      stickSize: 104,
      buttonSize: 62,
      buttonOpacity: 0.82,
      leftHanded: false,
      floatingStick: true,
      haptics: false,
      screenShake: true,
      reducedMotion: false,
      sfxVolume: 0,
      musicVolume: 0,
      hazards: true,
      onboardingSeen: true,
    }));
  }, { selectedLanguage: language });
}

export function observeBrowserIssues(page: Page): BrowserIssueLog {
  const log: BrowserIssueLog = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') log.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => log.pageErrors.push(error.message));
  return log;
}

export async function gotoMain(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-action="enter-main"]')).toBeVisible();
  await page.locator('[data-action="enter-main"]').click();
  await expect(page.locator('[data-action="quick"]')).toBeVisible();
}

export async function chooseFighters(page: Page): Promise<void> {
  await page.getByTestId('fighter-kade').click();
  await page.getByTestId('fighter-mira').click();
  await expect(page.locator('[data-action="fighters-next"]')).toBeEnabled();
  await page.locator('[data-action="fighters-next"]').click();
}

export async function startQuickMatch(page: Page): Promise<void> {
  await page.locator('[data-action="quick"]').click();
  await chooseFighters(page);
  await page.getByTestId('stage-vector-spire').click();
  await page.locator('[data-action="stages-next"]').click();
  await page.locator('[data-action="select-difficulty"][data-value="normal"]').click();
  await page.locator('[data-action="begin-match"]').click();
  await expect(page.locator('[data-game-shell]')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
}

export async function startTraining(page: Page): Promise<void> {
  await page.locator('[data-action="training"]').click();
  await chooseFighters(page);
  await page.getByTestId('stage-vector-spire').click();
  await page.locator('[data-action="stages-next"]').click();
  await expect(page.locator('.training-panel')).toBeVisible();
}

export async function dispatchPointer(
  page: Page,
  selector: string,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  pointerId: number,
  xRatio = 0.5,
  yRatio = 0.5,
): Promise<void> {
  await page.locator(selector).evaluate((element, detail) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(detail.eventType, {
      bubbles: true,
      cancelable: true,
      pointerId: detail.id,
      pointerType: 'touch',
      isPrimary: detail.id === 11,
      clientX: rect.left + rect.width * detail.x,
      clientY: rect.top + rect.height * detail.y,
      buttons: detail.eventType === 'pointerup' || detail.eventType === 'pointercancel' ? 0 : 1,
    }));
  }, { eventType: type, id: pointerId, x: xRatio, y: yRatio });
}

export async function holdTouchPause(page: Page): Promise<void> {
  await dispatchPointer(page, '[data-control="pause"]', 'pointerdown', 91);
  await page.waitForTimeout(80);
  await dispatchPointer(page, '[data-control="pause"]', 'pointerup', 91);
}

export async function forceResult(page: Page, winner: 'p1' | 'p2' = 'p1'): Promise<void> {
  await page.evaluate((winnerId) => {
    if (window.__RIFT_DEBUG__ === undefined) throw new Error('Test debug bridge is unavailable.');
    window.__RIFT_DEBUG__.forceResult(winnerId);
  }, winner);
  await expect(page.locator('.result-card')).toBeVisible();
}

export async function expectNoBrowserIssues(log: BrowserIssueLog): Promise<void> {
  expect(log.consoleErrors, 'browser console errors').toEqual([]);
  expect(log.pageErrors, 'unhandled page errors').toEqual([]);
}
