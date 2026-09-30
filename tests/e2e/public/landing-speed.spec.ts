import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

// "/" is the public waitlist, so this is what a stranger's first open costs:
// that page and the JS it downloads. The signed-in shell cannot be measured
// here without creating users.
const JS_BUDGET_BYTES = 250 * 1024;

test('a signed-out open of / renders the waitlist within the JS budget', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: /join the waitlist/i })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const scripts = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => new URL(name).pathname.endsWith('.js')))]);
  expect(scripts.length).toBeGreaterThan(0);
  // Gzipped here rather than read off the wire, so the number does not depend
  // on whether the local server compresses: the same way the build is measured.
  let total = 0;
  for (const url of scripts) total += gzipSync(await (await request.get(url)).body()).length;
  expect(total).toBeLessThanOrEqual(JS_BUDGET_BYTES);
});

test("Home's background reads refuse a signed-out caller and are never cached", async ({ request }) => {
  const brief = await request.get('/api/home/brief?weather=null', { maxRedirects: 0 });
  expect(brief.status()).toBe(401);
  expect(brief.headers()['cache-control']).toContain('no-store');
  expect(await brief.json()).toEqual({ state: 'off' });

  const portfolio = await request.get('/api/home/portfolio', { maxRedirects: 0 });
  expect(portfolio.status()).toBe(401);
  expect(portfolio.headers()['cache-control']).toContain('no-store');
  expect(await portfolio.json()).toBeNull();
});
