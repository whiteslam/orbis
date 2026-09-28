import { defineConfig, devices } from '@playwright/test';

// Public smoke suite: pages that need no sign-in. Unlike playwright.config.ts it has
// no global setup, so it never creates users in Supabase. Run with `pnpm test:public`.
// It builds and serves Orbis on :3100 so a running `pnpm dev` on :3000 is left alone.
export default defineConfig({
  testDir: 'tests/e2e/public',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
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
    env: {
      // Keep the sign-up path open so the login page renders the same way for every run.
      ORBIS_ALLOWED_EMAILS: '',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
