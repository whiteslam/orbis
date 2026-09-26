import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, openApp, test } from '../support/fixtures';
import { loadEnv } from '../support/env';

// Server secrets from .env.local that must never appear in anything the browser downloads.
const SECRET_KEYS = ['SUPABASE_SECRET_KEY', 'GOOGLE_CLIENT_SECRET', 'GMAIL_TOKEN_ENCRYPTION_KEY', 'OPENROUTER_API_KEY', 'GROWW_API_KEY', 'GROWW_API_SECRET', 'ALPHA_VANTAGE_API_KEY', 'COINGECKO_API_KEY', 'VAPID_PRIVATE_KEY', 'APP_LOCK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test('no server secret is present in the client bundle', () => {
  const env = loadEnv();
  const secrets = SECRET_KEYS.map((key) => [key, env[key]] as const).filter(([, value]) => value && value.length >= 12);
  const staticDir = path.join(__dirname, '..', '..', '..', '.next', 'static');
  const files = walk(staticDir).filter((file) => /\.(js|css|html|json)$/.test(file));
  expect(files.length).toBeGreaterThan(0);
  const leaks: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const [key, value] of secrets) if (content.includes(value!)) leaks.push(`${key} in ${path.basename(file)}`);
  }
  expect(leaks).toEqual([]);
});

test('secrets never reach the page, local storage or readable cookies', async ({ page, context }) => {
  const env = loadEnv();
  await openApp(page);
  const html = await page.content();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (!value || value.length < 12) continue;
    expect(html.includes(value), `${key} in HTML`).toBe(false);
    expect(storage.includes(value), `${key} in storage`).toBe(false);
  }
  const cookies = await context.cookies();
  const unlock = cookies.find((cookie) => cookie.name === 'orbis_unlock');
  expect(unlock?.httpOnly, 'app-lock cookie is httpOnly').toBe(true);
  expect(unlock?.sameSite).toBe('Lax');
});

test('user-supplied text is rendered as text, not HTML', async ({ page }) => {
  await openApp(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Profile', exact: true }).click();
  // Profile lands on Journal, so the name field needs its own section opening.
  await page.getByRole('tab', { name: 'Profile' }).click();
  const payload = `<img src=x onerror="window.__xss=1">QA-${Date.now()}`;
  await page.getByLabel('Name to use').fill(payload.slice(0, 80));
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  await openApp(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Profile', exact: true }).click();
  // Profile lands on Journal, so the name field needs its own section opening.
  await page.getByRole('tab', { name: 'Profile' }).click();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});
