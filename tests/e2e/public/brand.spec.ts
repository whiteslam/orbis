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

// The bottom nav only renders when signed in, so inject its markup into a page that
// ships the same stylesheets and read what the shipped CSS makes of it.
test('bottom nav is 60px with 10px labels and a gradient on the active tab', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<div class="phone-screen" style="position:fixed;inset:0;z-index:99"><nav class="bottom-nav">' +
      '<button class="active"><svg width="20" height="20"></svg><span>Today</span></button>' +
      '<button><svg width="20" height="20"></svg><span>Money</span></button></nav></div>');
  });
  const nav = await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).height);
  expect(nav).toBe('60px');
  const label = await page.locator('.bottom-nav button span').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(label).toBe('10px');
  const active = await page.locator('.bottom-nav button.active').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(active).toContain('linear-gradient');
  expect(active.replace(/\s/g, '')).toContain('rgb(91,180,232)');
  expect(active.replace(/\s/g, '')).toContain('rgb(66,204,168)');
});

test('primary buttons and the user bubble take the brand gradient; pills have teal, blue, red and gold fills', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<div id="probe" style="position:fixed;inset:0;z-index:99">' +
      '<button class="fd-button">Go</button><button class="fd-button ghost">Later</button>' +
      '<p class="talk-q">hi</p><p class="talk-a">hello</p>' +
      '<span class="pill teal">t</span><span class="pill blue">b</span><span class="pill red">r</span><span class="pill gold">g</span></div>');
  });
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundImage);
  const color = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg('#probe .fd-button:not(.ghost)')).toContain('linear-gradient');
  expect(await bg('#probe .fd-button.ghost')).not.toContain('linear-gradient');
  expect(await bg('#probe .talk-q')).toContain('linear-gradient');
  expect(await color('#probe .talk-a')).not.toBe('rgb(66, 204, 168)');
  expect(await color('#probe .pill.teal')).toBe('rgba(66, 204, 168, 0.16)');
  expect(await color('#probe .pill.blue')).toBe('rgba(91, 180, 232, 0.16)');
  expect(await color('#probe .pill.red')).toBe('rgba(242, 107, 107, 0.16)');
  expect(await color('#probe .pill.gold')).toBe('rgba(240, 180, 41, 0.16)');
});
