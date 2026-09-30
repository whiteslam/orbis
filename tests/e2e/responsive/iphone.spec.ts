import type { Browser, Page } from '@playwright/test';
import type { TestUser } from '../support/env';
import { expect, openApp, openInvestments, openSettings, openTab, test, TABS } from '../support/fixtures';

// An installed PWA on an iPhone 13: 390x844 CSS px with a 47px notch inset at
// the top and a 34px home-indicator inset at the bottom. Chromium cannot
// emulate env(safe-area-inset-*), so the insets are injected through the
// --safe-top / --safe-bottom custom properties every layout rule reads.
const IPHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;

async function openPhone(browser: Browser, user: TestUser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, storageState: user.storageState });
  const page = await context.newPage();
  await openApp(page);
  await page.addStyleTag({ content: `:root { --safe-top: ${SAFE_TOP}px; --safe-bottom: ${SAFE_BOTTOM}px; }` });
  return { context, page };
}

const box = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, height: rect.height };
});

const navTop = async (page: Page) => (await box(page, '.bottom-nav')).top;

test('iPhone: the nav sits above the home indicator', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA, IPHONE);
  const nav = await box(page, '.bottom-nav');
  expect(nav.bottom).toBeCloseTo(IPHONE.height - SAFE_BOTTOM - 10, 0);
  await context.close();
});

test('iPhone: Settings covers the screen, clears the notch, and ends above the nav', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA, IPHONE);
  await openSettings(page);
  const sheet = await box(page, '.settings-sheet');
  // No strip of the screen underneath shows around or below the nav.
  expect(sheet.top).toBe(0);
  expect(sheet.bottom).toBe(IPHONE.height);
  // Settings opens jumped to its first section; that jump stops below the notch.
  expect((await box(page, '#settings-you')).top).toBeGreaterThanOrEqual(SAFE_TOP);
  await page.locator('.settings-sheet').evaluate((element) => { element.scrollTop = 0; });
  expect((await box(page, '.settings-head h1')).top).toBeGreaterThanOrEqual(SAFE_TOP);

  await page.locator('.settings-sheet').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = await box(page, '.settings-sheet > :last-child');
  expect(last.bottom).toBeLessThanOrEqual(await navTop(page));
  await context.close();
});

test('iPhone: the Ask panel and its input sit above the nav and below the notch', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA, IPHONE);
  await page.getByRole('button', { name: 'Ask Orbis', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Ask Orbis' });
  await expect(panel).toBeVisible();
  const top = await navTop(page);
  const sheet = await box(page, '.talk-sheet');
  const input = await panel.getByLabel('Type a question').evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);
  expect(sheet.bottom).toBeLessThanOrEqual(top);
  expect(sheet.top).toBeGreaterThanOrEqual(SAFE_TOP);
  expect(input.bottom).toBeLessThanOrEqual(top);
  await context.close();
});

for (const viewport of [IPHONE, SMALL]) {
  test(`iPhone insets at ${viewport.width}x${viewport.height}: the New post action bar rests directly on the nav`, async ({ browser, userA }) => {
    const { context, page } = await openPhone(browser, userA, viewport);
    await openTab(page, 'Social');
    await page.locator('.so-new summary').click();
    await page.locator('.so-new-menu').getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.locator('.so-bar')).toBeVisible();
    const top = await navTop(page);
    const bar = await box(page, '.so-bar');
    expect(bar.top).toBeGreaterThanOrEqual(0);
    // Rests on the nav: not floating mid-form with fields showing between the two.
    expect(Math.abs(top - bar.bottom)).toBeLessThanOrEqual(2);

    // At the end of the form nothing is left under the nav.
    await page.locator('.screen-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const chips = await box(page, '.so-drawer .fd-chips');
    expect(chips.bottom).toBeLessThanOrEqual(top);
    const lastInForm = await box(page, '.so-drawer form > :last-child');
    expect(lastInForm.bottom).toBeLessThanOrEqual(top);
    await context.close();
  });
}

test('iPhone: Security buttons and Sign out stay on one line', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA, IPHONE);
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  for (const name of ['Lock now', 'Change PIN', 'Sign out']) {
    const button = settings.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const height = await button.evaluate((element) => element.getBoundingClientRect().height);
    const lineHeight = await button.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight) || parseFloat(getComputedStyle(element).fontSize) * 1.3);
    expect(height, `${name} height`).toBeLessThanOrEqual(48);
    // One line of text: the content box holds a single line.
    const padding = await button.evaluate((element) => { const style = getComputedStyle(element); return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth); });
    expect(height - padding, `${name} lines`).toBeLessThan(lineHeight * 1.5);
  }
  await context.close();
});

for (const viewport of [IPHONE, SMALL]) {
  test(`iPhone insets at ${viewport.width}x${viewport.height}: every tab scrolls clear of the nav`, async ({ browser, userA }) => {
    const { context, page } = await openPhone(browser, userA, viewport);
    const screens: Array<{ name: string; open: () => Promise<void> }> = [
      ...TABS.map((tab) => ({ name: tab, open: () => openTab(page, tab) })),
      { name: 'Investments', open: () => openInvestments(page) },
    ];
    for (const screen of screens) {
      await screen.open();
      await page.waitForTimeout(400);
      const result = await page.locator('.screen-body').first().evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        const children = [...element.children].filter((child) => child.getBoundingClientRect().height > 0);
        const last = children.at(-1)!;
        return { bottom: last.getBoundingClientRect().bottom };
      });
      expect(result.bottom, `${screen.name} last child`).toBeLessThanOrEqual(await navTop(page));
    }
    await context.close();
  });
}
