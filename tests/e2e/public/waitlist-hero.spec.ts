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
  await expect(chips).toHaveText(['Read-only connections', 'AI you can switch off', 'Private by default']);
});

test('the join form sits on the page with no panel around it, and has a gradient button', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#join');
  const panel = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, image: s.backgroundImage, color: s.backgroundColor };
  });
  expect(panel).toEqual({ border: '0px', image: 'none', color: 'rgba(0, 0, 0, 0)' });
  const button = card.getByRole('button', { name: /join the waitlist/i });
  expect(await button.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await expect(card.getByLabel('Email')).toBeVisible();
  await expect(card.getByText('One email when your invite is ready. Nothing else, ever.')).toBeVisible();
});

test('the hero backdrop is the Orbis ring as an eclipse in a starfield, drawn without a canvas', async ({ page }) => {
  await page.goto('/');
  const space = page.locator('.wl-hero .wl-space');
  await expect(space).toHaveAttribute('aria-hidden', 'true');
  await expect(space.locator('.wl-eclipse-ring')).toBeVisible();
  await expect(space.locator('.wl-stars')).toHaveCount(2);
  await expect(page.locator('.wl-hero canvas')).toHaveCount(0);
  const ring = await space.locator('.wl-eclipse-ring').evaluate((el) => getComputedStyle(el).animationName);
  expect(ring).toBe('wl-spin');
});

test('with reduced motion the sky holds still', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  const names = await page.locator('.wl-space *').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(names.every((name) => name === 'none')).toBe(true);
  await context.close();
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

test('below the hero: a captioned sample brief, four privacy controls, and the page ends on a second join form', async ({ page }) => {
  await page.goto('/');
  const sample = page.locator('figure.wl-sample');
  await expect(sample).toBeVisible();
  await expect(sample.locator('figcaption')).toHaveText('A sample brief. The figures are made up.');
  await expect(page.getByRole('heading', { level: 2, name: 'Only what you connect' })).toBeVisible();
  await expect(page.locator('.wl-controls li')).toHaveCount(4);
  await expect(page.getByText(/never trains/i)).toHaveCount(0);
  const close = page.locator('.wl-close');
  await expect(close.getByRole('heading', { level: 2, name: 'Your invite, when it’s your turn' })).toBeVisible();
  await expect(close.getByRole('button', { name: /join the waitlist/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /join the waitlist/i })).toHaveCount(2);
});
