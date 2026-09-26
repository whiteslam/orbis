import { expect, openApp, openTab, test, type Tab } from '../support/fixtures';

const TABS: Array<[Tab, RegExp]> = [
  ['Expense', /#finance$/],
  ['Health', /#health$/],
  ['Invest', /#invest$/],
  ['Profile', /#profile$/],
];

test('every tab opens, is reflected in the URL, and survives a reload', async ({ page, consoleErrors }) => {
  await openApp(page);
  for (const [tab, hash] of TABS) {
    await openTab(page, tab);
    await expect(page).toHaveURL(hash);
    await expect(page.getByRole('navigation').getByRole('button', { name: tab, exact: true })).toHaveClass(/active/);
    await page.reload();
    await openApp(page, page.url().replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByRole('navigation').getByRole('button', { name: tab, exact: true })).toHaveClass(/active/);
  }
  await openTab(page, 'Home');
  await expect(page).not.toHaveURL(/#/);
  expect(consoleErrors).toEqual([]);
});

test('deep link opens the requested tab', async ({ page }) => {
  await openApp(page, '/#invest');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Invest', exact: true })).toHaveClass(/active/);
});

test('mobile keyboard: a focused field near the bottom stays visible above the nav', async ({ browser, userA }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: userA.storageState });
  const page = await context.newPage();
  await openApp(page);
  await openTab(page, 'Profile');
  // Profile now lands on Journal, so the name field needs its section opening first.
  await page.getByRole('tab', { name: 'Profile' }).click();
  const field = page.getByLabel('Name to use');
  await field.focus();
  await page.waitForTimeout(700);
  const { fieldBox, navTop, stageScroll } = await page.evaluate(() => ({
    fieldBox: document.activeElement!.getBoundingClientRect().toJSON() as DOMRect,
    navTop: document.querySelector('.bottom-nav')!.getBoundingClientRect().top,
    stageScroll: document.querySelector('.stage')!.scrollTop,
  }));
  expect(fieldBox.top).toBeGreaterThanOrEqual(0);
  expect(fieldBox.bottom).toBeLessThanOrEqual(navTop);
  expect(stageScroll).toBe(0);
  await context.close();
});
