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
