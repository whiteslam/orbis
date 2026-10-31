import type { Browser } from '@playwright/test';
import type { TestUser } from '../support/env';
import { expect, openApp, openSettings, openTab, test } from '../support/fixtures';

// components/motion/motion-runtime.tsx and app/styles/motion.css: selection
// glides, sheets follow the finger and leave the way they came, and none of
// it happens under Reduce Motion.

async function openPhone(browser: Browser, user: TestUser, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: user.storageState, reducedMotion });
  const page = await context.newPage();
  await openApp(page);
  return { context, page };
}

test('the tab bar and segmented controls glide their selection', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA);
  const nav = page.locator('.bottom-nav');
  await nav.getByRole('button', { name: 'Money', exact: true }).click();
  await expect(nav.locator('.glide-ghost')).toHaveCount(1);
  await expect(nav.locator('.glide-ghost')).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Money', exact: true })).toHaveClass(/active/);

  const investments = page.getByRole('tab', { name: 'Investments' });
  await investments.click();
  await expect(page.locator('.glide-ghost')).toHaveCount(1);
  await expect(page.locator('.glide-ghost')).toHaveCount(0);
  await expect(investments).toHaveAttribute('aria-selected', 'true');
  await expect(investments).not.toHaveClass(/glide-target/);
  await context.close();
});

test('Settings can be flicked down by its header to close', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA);
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await page.waitForTimeout(700);
  const head = await page.locator('.settings-head').boundingBox();
  if (!head) throw new Error('no Settings header');
  // A short, quick pull: the projection of the flick carries it past the line.
  // The middle of the bar: clear of the Close button, and of the Next.js dev badge in dev.
  const x = head.x + head.width / 2;
  const y = head.y + head.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(x, y + step * 30, { steps: 1 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();
  await context.close();
});

test('a small pull on Settings springs back instead of closing', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA);
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await page.waitForTimeout(700);
  const head = await page.locator('.settings-head').boundingBox();
  if (!head) throw new Error('no Settings header');
  // The middle of the bar: clear of the Close button, and of the Next.js dev badge in dev.
  const x = head.x + head.width / 2;
  const y = head.y + head.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(x, y + step * 4);
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(900);
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => (element as HTMLElement).style.transform)).toBe('');
  await context.close();
});

test('Ask Orbis plays its exit when closed with a tap, and closes at once from the keyboard', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA);
  const button = page.getByRole('button', { name: 'Ask Orbis', exact: true });
  const panel = page.getByRole('region', { name: 'Ask Orbis' });
  await button.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  // Still on screen while it shrinks back into the button, then gone.
  await expect(panel).toBeVisible();
  await expect(panel).toBeHidden();

  await button.click();
  await panel.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden({ timeout: 100 });
  await context.close();
});

test('under Reduce Motion nothing glides and sheets close at once', async ({ browser, userA }) => {
  const { context, page } = await openPhone(browser, userA, 'reduce');
  await openTab(page, 'Money');
  await expect(page.locator('.glide-ghost')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask Orbis', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Ask Orbis' });
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden({ timeout: 100 });
  await context.close();
});
