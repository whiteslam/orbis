import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, type FullConfig } from '@playwright/test';
import { AUTH_DIR, TEST_PIN, USERS_FILE, supabaseAdmin, type TestUsers } from './env';

// Creates two throwaway users (A and B) and saves a signed-in browser state for each.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3100';
  const admin = supabaseAdmin();
  mkdirSync(AUTH_DIR, { recursive: true });
  const run = randomBytes(4).toString('hex');

  const users = {} as TestUsers;
  for (const key of ['a', 'b'] as const) {
    const email = `orbis-qa-${key}-${run}@example.com`;
    const password = `Qa-${randomBytes(12).toString('base64url')}!9`;
    const id = await admin.createUser(email, password);
    users[key] = { id, email, password, storageState: path.join(AUTH_DIR, `${key}.json`) };
  }
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  const browser = await chromium.launch();
  for (const user of Object.values(users)) {
    const page = await browser.newPage({ baseURL });
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });
    // New accounts must choose a device PIN before Orbis opens.
    await page.getByLabel('Choose a PIN').fill(TEST_PIN);
    await page.getByLabel('Enter it again').fill(TEST_PIN);
    await page.getByRole('navigation').waitFor({ timeout: 30_000 });
    await page.context().storageState({ path: user.storageState });
    await page.close();
  }
  await browser.close();
}
