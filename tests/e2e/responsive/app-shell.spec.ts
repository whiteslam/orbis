import { expect, openApp, openTab, test } from '../support/fixtures';

const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

// On phones Orbis is a full-screen app: the shell fills the viewport and the
// bottom navigation sits on the bottom edge (not floating mid-screen).
for (const viewport of PHONES) {
  test(`app shell fills the screen at ${viewport.width}x${viewport.height}`, async ({ browser, userA }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, storageState: userA.storageState });
    const page = await context.newPage();
    await openApp(page);
    // Regression: tab switches and focusing a field used to scroll the hidden
    // .stage wrapper, leaving the whole app (and bottom nav) shifted up ~100px.
    for (const tab of ['Expense', 'Health', 'Invest', 'Profile', 'Home'] as const) await openTab(page, tab);
    // Any field will do: the regression was that focusing one scrolled the
    // hidden .stage wrapper. This used the growth projector's SIP input, which
    // no longer exists, so it uses the manual expense amount instead.
    await openTab(page, 'Expense');
    await page.getByRole('button', { name: /^(Add manually|Add one now)$/ }).first().click();
    const field = page.getByLabel('Amount');
    await field.focus();
    await page.waitForTimeout(600);
    await field.blur();
    const metrics = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        stageScrollTop: document.querySelector('.stage')?.scrollTop,
        phone: rect('.phone')?.height,
        navBottom: rect('.bottom-nav')?.bottom,
        dvh: (() => { const probe = document.createElement('div'); probe.style.height = '100dvh'; document.body.append(probe); const value = probe.getBoundingClientRect().height; probe.remove(); return value; })(),
      };
    });
    console.log(JSON.stringify({ viewport, ...metrics }));
    expect(metrics.phone).toBeCloseTo(metrics.innerHeight, 0);
    // The nav is a floating pill inset from the edge, so it is never flush with
    // it. What this guards against is the app being scrolled up wholesale, which
    // moved it by about 100px, so the check is that the gap stays small.
    expect(metrics.innerHeight! - metrics.navBottom!).toBeGreaterThanOrEqual(0);
    expect(metrics.innerHeight! - metrics.navBottom!).toBeLessThan(24);
    expect(metrics.stageScrollTop).toBe(0);
    await context.close();
  });
}

test('landscape phone uses the full-screen app, not the desktop phone frame', async ({ browser, userA }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, storageState: userA.storageState });
  const page = await context.newPage();
  await openApp(page);
  const { phoneWidth, navBottom } = await page.evaluate(() => ({
    phoneWidth: document.querySelector('.phone')!.getBoundingClientRect().width,
    navBottom: document.querySelector('.bottom-nav')!.getBoundingClientRect().bottom,
  }));
  expect(phoneWidth).toBeCloseTo(844, 0);
  // Same floating pill as in portrait: near the bottom edge, not flush with it.
  expect(390 - navBottom).toBeGreaterThanOrEqual(0);
  expect(390 - navBottom).toBeLessThan(24);
  await context.close();
});
