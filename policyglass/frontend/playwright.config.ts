import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['json', { outputFile: '../.runtime/e2e/results.json' }]],
  outputDir: '../.runtime/e2e/test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1100 },
    headless: true,
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--disable-crash-reporter', '--disable-breakpad', '--enable-unsafe-swiftshader'],
    },
  },
});
