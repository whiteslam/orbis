import { expect, test } from '@playwright/test';

// docs/design/apple.md: Apple's grouped palette in both appearances, the
// device's appearance unless one was chosen, and the system font.
// The production build minifies colours (#ffffff becomes #fff), so short hex is expanded.
const readRoot = async (page: import('@playwright/test').Page, name: string) => {
  const value = await page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);
  return /^#[\da-f]{3}$/.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : value;
};

test('the appearance follows the device until one is chosen', async ({ browser }) => {
  for (const [scheme, theme, bg, surface, body] of [
    ['light', 'light', '#f2f2f7', '#ffffff', 'rgb(242, 242, 247)'],
    ['dark', 'dark', '#000000', '#1c1c1e', 'rgb(0, 0, 0)'],
  ] as const) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto('/login');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    expect(await readRoot(page, '--sys-bg')).toBe(bg);
    expect(await readRoot(page, '--sys-surface')).toBe(surface);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(body);
    await context.close();
  }
});

test('a stored light choice still wins over a dark device', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => localStorage.setItem('orbis-theme', 'light'));
  const page = await context.newPage();
  await page.goto('/login');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(await readRoot(page, '--sys-bg')).toBe('#f2f2f7');
  await context.close();
});

test('the body font is the system font, and no web font is fetched', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com|\.woff2?(\?|$)/.test(r.url())) external.push(r.url()); });
  await page.goto('/login');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/^-apple-system, BlinkMacSystemFont, system-ui/);
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
  await expect(page.locator('.orbis-mark svg')).toHaveCount(0);
});

test('cells are 22px with no border, and fields are filled with no border', async ({ page }) => {
  await page.goto('/login');
  expect(await readRoot(page, '--r-card')).toBe('22px');
  expect(await readRoot(page, '--r-field')).toBe('10px');
  const input = page.locator('.auth-form input').first();
  expect(await input.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
});

// The bottom nav only renders when signed in, so inject its markup into a page that
// ships the same stylesheets and read what the shipped CSS makes of it.
test('bottom nav is 60px with 10px labels, and the active tab is the tint on grey, not a gradient', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/login');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<div class="phone-screen" style="position:fixed;inset:0;z-index:99"><nav class="bottom-nav">' +
      '<button class="active"><svg width="20" height="20"></svg><span>Today</span></button>' +
      '<button><svg width="20" height="20"></svg><span>Money</span></button></nav></div>');
  });
  expect(await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).height)).toBe('60px');
  expect(await page.locator('.bottom-nav button span').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('10px');
  const active = await page.locator('.bottom-nav button.active').evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, color: s.color };
  });
  expect(active.image).toBe('none');
  // --tint-label in light: #066452, 6.2:1 on the grey fill.
  expect(active.color).toBe('rgb(6, 100, 82)');
  await context.close();
});

test('primary buttons and the user bubble are the flat tint; badges use system colours', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/login');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<div id="probe" style="position:fixed;inset:0;z-index:99">' +
      '<button class="fd-button">Go</button><button class="fd-button ghost">Later</button>' +
      '<p class="talk-q">hi</p><p class="talk-a">hello</p>' +
      '<span class="pill teal">t</span><span class="pill red">r</span></div>');
  });
  const look = (sel: string) => page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, color: s.backgroundColor };
  });
  const tint = 'rgb(66, 204, 168)';
  expect(await look('#probe .fd-button:not(.ghost)')).toEqual({ image: 'none', color: tint });
  expect((await look('#probe .fd-button.ghost')).color).not.toBe(tint);
  expect(await look('#probe .talk-q')).toEqual({ image: 'none', color: tint });
  expect((await look('#probe .talk-a')).color).toBe('rgba(0, 0, 0, 0)');
  expect((await look('#probe .pill.teal')).color).toBe('rgba(66, 204, 168, 0.16)');
  expect((await look('#probe .pill.red')).color).toBe('rgba(255, 69, 58, 0.16)');
  await context.close();
});

test('the public pages that never load the app stylesheets use the system font too', async ({ page }) => {
  await page.goto('/privacy');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/^-apple-system/);
});

test('the logo hole is see-through: the ring is masked, not painted over', async ({ page }) => {
  await page.goto('/login');
  const mark = page.locator('.orbis-mark').first();
  const style = await mark.evaluate((el) => {
    const s = getComputedStyle(el);
    const hole = getComputedStyle(el.firstElementChild!);
    return { mask: s.maskImage || s.webkitMaskImage, hole: hole.backgroundColor };
  });
  expect(style.mask).toContain('radial-gradient');
  expect(style.hole).toBe('rgba(0, 0, 0, 0)');
});

test('the installed app opens on the brand background', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.background_color.toLowerCase()).toBe('#0e0e10');
  expect(manifest.theme_color.toLowerCase()).toBe('#0e0e10');
});
