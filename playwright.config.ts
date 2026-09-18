import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
