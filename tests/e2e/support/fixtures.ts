import { test as base, expect, type Page } from '@playwright/test';
import { readUsers, TEST_PIN, type TestUser } from './env';

export type Tab = 'Today' | 'Money' | 'Health' | 'Journal' | 'Social';

/** Where the app lives. Not '/': that is the public waitlist, which bounces a signed-in visitor here. */
export const APP_PATH = '/active';

/** Rewrites an app-relative path written as '/', '/#tab' or '/?query' onto APP_PATH. */
function appPath(path: string) {
  if (path === '/') return APP_PATH;
  if (path.startsWith('/#') || path.startsWith('/?')) return APP_PATH + path.slice(1);
  return path;
}

/**
 * Which account this browser context holds, read from its Supabase session
 * cookie.
 *
 * It used to be read off the lock screen, which named the signed-in address.
 * That line is gone: naming the account on the one authenticated page a
 * passer-by can reach was a real leak, so the test now looks where a test may
 * legitimately look — the cookie it was handed — rather than relying on the app
 * to print a secret.
 */
async function signedInEmail(page: Page): Promise<string | null> {
  try {
    const parts = (await page.context().cookies())
      .filter((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name))
      // Chunked cookies are numbered, so sort numerically before joining.
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!parts.length) return null;
    let raw = decodeURIComponent(parts.map((cookie) => cookie.value).join(''));
    if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
    const token = (JSON.parse(raw) as { access_token?: unknown }).access_token;
    if (typeof token !== 'string') return null;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Opens Orbis as a signed-in user, clearing the app lock if it is showing.
 *
 * The lock expires after APP_LOCK_IDLE_MS, which is five minutes, and a full
 * run takes longer than that. Every test past the five minute mark therefore
 * meets a lock screen, and which one depends on whether the device PIN is
 * active: this handles both, because only handling the PIN meant the back half
 * of the suite failed on a screen it could not read.
 */
export async function openApp(page: Page, path = APP_PATH) {
  await page.goto(appPath(path));
  const nav = page.getByRole('navigation');
  const pin = page.getByLabel('Enter your PIN');
  const password = page.getByLabel('Password', { exact: true });
  await expect(nav.or(pin).or(password)).toBeVisible({ timeout: 30_000 });

  if (await pin.isVisible()) {
    await pin.fill(TEST_PIN);
  } else if (await password.isVisible()) {
    const email = await signedInEmail(page);
    const users = readUsers();
    const user = [users.a, users.b].find((candidate) => candidate.email.toLowerCase() === email);
    if (!user) throw new Error(`Locked as an unknown user: ${email ?? 'no session cookie'}`);
    await password.fill(user.password);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
  await expect(nav).toBeVisible({ timeout: 30_000 });
}

export async function openTab(page: Page, tab: Tab) {
  await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
}

/** Every tab, in nav order. Specs that visit all tabs use this, so a layout change is one edit. */
export const TABS: Tab[] = ['Today', 'Money', 'Health', 'Journal', 'Social'];

/** Money opens on Spending; this switches it to Investments. */
export async function openInvestments(page: Page) {
  await openTab(page, 'Money');
  await page.getByRole('tab', { name: 'Investments' }).click();
}

/** Opens Settings from the avatar in the current screen's header. */
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
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
