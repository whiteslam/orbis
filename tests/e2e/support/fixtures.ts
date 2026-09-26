import { test as base, expect, type Page } from '@playwright/test';
import { readUsers, TEST_PIN, type TestUser } from './env';

export type Tab = 'Home' | 'Expense' | 'Health' | 'Invest' | 'Profile';

/**
 * Opens Orbis as a signed-in user, clearing the app lock if it is showing.
 *
 * The lock expires after APP_LOCK_IDLE_MS, which is five minutes, and a full
 * run takes longer than that. Every test past the five minute mark therefore
 * meets a lock screen, and which one depends on whether the device PIN is
 * active: this handles both, because only handling the PIN meant the back half
 * of the suite failed on a screen it could not read.
 */
export async function openApp(page: Page, path = '/') {
  await page.goto(path);
  const nav = page.getByRole('navigation');
  const pin = page.getByLabel('Enter your PIN');
  const password = page.getByLabel('Password', { exact: true });
  await expect(nav.or(pin).or(password)).toBeVisible({ timeout: 30_000 });

  if (await pin.isVisible()) {
    await pin.fill(TEST_PIN);
  } else if (await password.isVisible()) {
    // The screen names who is signed in, which is how we know whose password to use.
    const signedInAs = await page.getByText(/@example\.com/).first().innerText();
    const users = readUsers();
    const user = [users.a, users.b].find((candidate) => signedInAs.includes(candidate.email));
    if (!user) throw new Error(`Locked as an unknown user: ${signedInAs}`);
    await password.fill(user.password);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
  await expect(nav).toBeVisible({ timeout: 30_000 });
}

export async function openTab(page: Page, tab: Tab) {
  await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
}

type Fixtures = {
  userA: TestUser;
  userB: TestUser;
  consoleErrors: string[];
};

// Every test signs in as user A and fails on unexpected console errors or failed same-origin requests.
export const test = base.extend<Fixtures>({
  userA: async ({}, use) => use(readUsers().a),
  userB: async ({}, use) => use(readUsers().b),
  storageState: async ({}, use) => use(readUsers().a.storageState),
  consoleErrors: async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Next dev-only noise, not app errors.
      if (/Download the React DevTools|\[Fast Refresh\]|webpack-hmr|__nextjs_original-stack-frame/.test(text)) return;
      // The failing URL is reported by the response listener below.
      if (text.startsWith('Failed to load resource')) return;
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      const url = response.url();
      if (baseURL && url.startsWith(baseURL) && (response.status() >= 500 || response.status() === 404)) errors.push(`HTTP ${response.status()} ${url}`);
    });
    await use(errors);
  },
});

export { expect };
