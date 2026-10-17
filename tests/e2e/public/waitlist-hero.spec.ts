import { expect, test } from '@playwright/test';

test('the header has a Log in link to /login and a Join waitlist link to the form', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header.wl-header');
  await expect(header.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  const join = header.getByRole('link', { name: 'Join waitlist' });
  await expect(join).toHaveAttribute('href', '#join');
  expect(await join.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await expect(page.locator('#join').getByRole('button', { name: /join the waitlist/i })).toBeVisible();
});

test('the hero names the beta, picks out "one calm page" in the brand gradient, and lists three trust points', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.wl-hero');
  await expect(hero.getByText('Private beta')).toBeVisible();
  const h1 = hero.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(/one calm page/i);
  const accent = h1.locator('.wl-grad');
  await expect(accent).toHaveText(/one calm page/i);
  const style = await accent.evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, clip: s.webkitBackgroundClip || s.backgroundClip };
  });
  expect(style.image).toContain('linear-gradient');
  expect(style.clip).toBe('text');
  const chips = hero.locator('.wl-trust li');
  await expect(chips).toHaveText(['Read-only connections', 'Never trains AI on your data', 'Private by default']);
});

test('the join form is one glass panel with a gradient button and still joins', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#join');
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  const button = card.getByRole('button', { name: /join the waitlist/i });
  expect(await button.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await expect(card.getByLabel('Email')).toBeVisible();
  await expect(card.getByText('One email when your invite is ready. Nothing else, ever.')).toBeVisible();
});

test('on a phone the header keeps Log in and Join, and nothing scrolls sideways', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  const header = page.locator('header.wl-header');
  await expect(header.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Join waitlist' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth + 1)).toBe(true);
  await context.close();
});
