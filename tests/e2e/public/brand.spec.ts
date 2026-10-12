import { expect, test } from '@playwright/test';

test('dark brand palette is the default, whatever the OS prefers', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/login');
  const read = (n: string) =>
    page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(), n);
  expect(await read('--sys-bg')).toBe('#0e0e10');
  expect(await read('--sys-surface')).toBe('#141416');
  expect(await read('--sys-surface-2')).toBe('#1a1a1e');
  expect(await read('--sys-separator')).toBe('#242428');
  expect(await read('--brand-teal')).toBe('#42cca8');
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe('rgb(14, 14, 16)');
  await context.close();
});

test('a stored light choice still wins', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => localStorage.setItem('orbis-theme', 'light'));
  const page = await context.newPage();
  await page.goto('/login');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sys-bg').trim().toLowerCase());
  expect(bg).not.toBe('#0e0e10');
  await context.close();
});

test('DM Sans is the body font and ships without a request to Google', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url()); });
  await page.goto('/login');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/DM Sans|dm_sans|__DM_Sans/i);
  expect(external).toEqual([]);
});

test('the logo is a conic-gradient ring with a 45% hole, not an image', async ({ page }) => {
  await page.goto('/login');
  const mark = page.locator('.orbis-mark').first();
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((el) => el.tagName)).toBe('SPAN');
  expect(await mark.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('conic-gradient');
  const [outer, hole] = await mark.evaluate((el) => [
    el.getBoundingClientRect().width,
    el.firstElementChild!.getBoundingClientRect().width,
  ]);
  expect(hole / outer).toBeGreaterThan(0.43);
  expect(hole / outer).toBeLessThan(0.47);
  expect(await page.locator('.orbis-mark svg').count()).toBe(0);
});

test('cards and fields use the 16px radius and the 1px brand border', async ({ page }) => {
  await page.goto('/login');
  const root = (n: string) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), n);
  expect(await root('--r-lg')).toBe('16px');
  expect(await root('--r-xl')).toBe('16px');
  const input = page.locator('.auth-form input').first();
  const style = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, width: s.borderTopWidth, color: s.borderTopColor };
  });
  expect(style).toEqual({ radius: '16px', width: '1px', color: 'rgb(36, 36, 40)' });
});
