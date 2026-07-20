import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4202',
    viewport: { width: 780, height: 360 },
    locale: 'ko-KR',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --port 4202 --strictPort',
    url: 'http://127.0.0.1:4202',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
