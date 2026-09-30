import { expect, test } from '@playwright/test';

// Everything a stranger can fetch without signing in. If any of these named the
// app's own route, "view source" would be the way in.
const PUBLIC_FILES = ['/', '/waitlist', '/manifest.webmanifest', '/sw.js', '/robots.txt', '/sitemap.xml', '/privacy', '/terms', '/support', '/offline'];

// An address that is not the form's own placeholder. The waitlist has to show
// `you@example.com`; it must not show anybody's real address.
const REAL_EMAIL = /[A-Za-z0-9._%+-]+@(?!example\.(com|org))[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

test('nothing a signed-out visitor can fetch names the app route', async ({ request }) => {
  const found: string[] = [];
  for (const file of PUBLIC_FILES) {
    const response = await request.get(file, { maxRedirects: 0 });
    expect(response.status(), file).toBeLessThan(400);
    if ((await response.text()).includes('/active')) found.push(file);
  }
  expect(found).toEqual([]);
});

test('the waitlist carries no personal information', async ({ page, request }) => {
  await page.goto('/');
  const html = await page.content();
  expect(html.match(REAL_EMAIL)?.[0] ?? null).toBeNull();

  // The JS it downloads is the other half of "inspect the website": a route
  // string compiled into a chunk is just as readable as one in the markup.
  await page.waitForLoadState('networkidle');
  const scripts = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => new URL(name).pathname.endsWith('.js')))]);
  expect(scripts.length).toBeGreaterThan(0);
  const leaks: string[] = [];
  for (const url of scripts) {
    const body = await (await request.get(url)).text();
    if (body.includes('/active')) leaks.push(new URL(url).pathname);
  }
  expect(leaks).toEqual([]);
});

// Names that would answer "what does this thing connect to?" for someone reading
// the Network tab. The app's stylesheets carry selectors like .groww-card and
// .gmail-review-merchant, and a shared component once carried a literal map of
// every provider; both used to be downloaded by strangers.
const APP_TERMS = ['groww', 'gmail', 'zerodha', 'kite', 'apple-health', 'open-meteo', 'workbook', 'broker', 'journal', 'headsup', 'routine'];

test('nothing the waitlist downloads names a service Orbis connects to', async ({ page, request }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Exactly what the browser fetched, so a noModule polyfill it skipped is not counted.
  const urls = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\.(js|css)$/.test(new URL(name).pathname)));
  expect(urls.length).toBeGreaterThan(0);

  const found: string[] = [];
  let bytes = 0;
  for (const url of new Set(urls)) {
    const body = await (await request.get(url)).text();
    bytes += body.length;
    const lower = body.toLowerCase();
    for (const term of APP_TERMS) if (lower.includes(term)) found.push(`${term} in ${new URL(url).pathname}`);
  }
  expect(found).toEqual([]);
  // A guard on the weight too: the app's CSS coming back would blow straight through this.
  expect(bytes).toBeLessThan(900_000);
});

test('joining the waitlist stores the address and answers with a place in the queue', async ({ page }) => {
  await page.goto('/');
  const email = `orbis-qa-waitlist-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /join the waitlist/i }).click();
  await expect(page.getByRole('heading', { name: /on the list/i })).toBeVisible({ timeout: 15_000 });
  // The number is read back out of the table after the insert, so seeing one is
  // proof the address was stored and not merely accepted. Teardown removes it.
  await expect(page.getByText(/You’re number \d+/)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});
