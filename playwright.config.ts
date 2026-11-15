import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4318',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'node --import tsx server/index.ts',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: false,
    env: {
      COUNTERLAB_PORT: '4318',
      COUNTERLAB_DATA_DIR: resolve('.runtime/e2e-' + Date.now()),
      COUNTERLAB_AI_KEY: '',
      COUNTERLAB_AI_BASE_URL: '',
      COUNTERLAB_AI_MODEL: '',
    },
    timeout: 20_000,
  },
});
