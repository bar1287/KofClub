import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive real browsers against a fully running stack
 * (started by scripts/e2e.sh, which sets E2E_BASE_URL).
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE lets environments with a pre-installed
 * Chromium skip `playwright install`.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
});
