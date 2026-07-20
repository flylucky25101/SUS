import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4201',
    locale: 'ko-KR',
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'no-preference' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --mode test --port 4201 --strictPort',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'galaxy-s23-landscape',
      use: { viewport: { width: 780, height: 360 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'galaxy-s23-portrait',
      use: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'narrow-320',
      use: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-360x800',
      use: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-393x873',
      use: { viewport: { width: 393, height: 873 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-412x915',
      use: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-844x390-landscape',
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-915x412-landscape',
      use: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    },
  ],
});
