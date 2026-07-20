import { expect, test } from '@playwright/test';

test('production build installs and reloads offline with its assets', async ({ context, page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('rift-forge.settings.v1', JSON.stringify({ version: 1, onboardingSeen: true }));
  });

  await page.goto('/');
  await expect(page.locator('[data-action="enter-main"]')).toBeVisible();

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) throw new Error('Manifest link is missing.');
    const response = await fetch(link.href);
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    return response.json() as Promise<{ display?: string; orientation?: string; icons?: unknown[] }>;
  });
  expect(manifest).toMatchObject({ display: 'standalone', orientation: 'landscape' });
  expect(manifest.icons?.length).toBeGreaterThanOrEqual(2);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Service worker did not claim the page.')), 8_000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  });

  const cachedAssets = await page.evaluate(async () => {
    const entries = await Promise.all((await caches.keys()).map(async (key) => {
      const cache = await caches.open(key);
      return Promise.all((await cache.keys()).map(async (request) => ({
        path: new URL(request.url).pathname,
        bytes: (await (await cache.match(request))?.arrayBuffer())?.byteLength ?? 0,
      })));
    }));
    return entries.flat();
  });
  expect(cachedAssets.some(({ path, bytes }) => /\/assets\/.*\.js$/.test(path) && bytes > 100_000)).toBe(true);
  expect(cachedAssets.some(({ path, bytes }) => /\/assets\/.*\.css$/.test(path) && bytes > 10_000)).toBe(true);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-action="enter-main"]')).toBeVisible();
    await expect(page.locator('.brand-rift')).toHaveText('RIFT');
    expect(pageErrors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
