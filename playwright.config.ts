import { defineConfig, devices } from '@playwright/test';

// E2E suite: creates two temporary users, runs against a local production build, then deletes them.
// Run with `pnpm test:e2e`. It builds and serves Orbis on :3100 so dev-only overlays don't
// affect results and a running `pnpm dev` on :3000 is left alone.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.report' }]],
  globalSetup: './tests/e2e/support/global-setup.ts',
  globalTeardown: './tests/e2e/support/global-teardown.ts',
  outputDir: 'tests/e2e/.results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'pnpm build && pnpm start -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
