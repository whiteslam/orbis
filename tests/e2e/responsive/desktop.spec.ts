import { expect, openApp, openTab, settle, test, TABS } from '../support/fixtures';

// The desktop layout (docs/superpowers/plans/2026-10-27-web-desktop.md) is
// behind NEXT_PUBLIC_DESKTOP_LAYOUT=1, a build-time switch. A build without it
// is the phone mock-up at every width, which the other responsive specs cover,
// so these skip unless the app under test was built with it on.
test.beforeEach(async ({ page }) => {
  await openApp(page);
  test.skip(await page.locator('.stage[data-desktop]').count() === 0, 'built without NEXT_PUBLIC_DESKTOP_LAYOUT=1');
});

test.describe('at 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the rail is the only navigation and the phone frame is gone', async ({ page, consoleErrors }) => {
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.locator('.dk-rail')).toBeVisible();
    await expect(page.locator('.dk-header')).toBeVisible();
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await expect(page.locator('.phone-speaker')).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('no tab scrolls sideways', async ({ page }) => {
    for (const tab of TABS) {
      await openTab(page, tab);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test('Ctrl+K opens the palette and Escape gives focus back', async ({ page }) => {
    const today = page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true });
    await today.focus();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search Orbis' });
    await expect(palette).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search tabs, settings and Career pages' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(today).toBeFocused();
  });

  test('links into the app land on the same tab as on the phone', async ({ page }) => {
    const stage = page.locator('.stage');
    await page.goto('/active#social/2026-11');
    await expect(stage).toHaveAttribute('data-tab', 'social');
    await page.goto('/active?tab=career');
    await expect(stage).toHaveAttribute('data-tab', 'career');
    // Reached by URL, Career is the rail's current item even though the rail's Career leaves for the panel.
    await expect(page.locator('.dk-rail a[href="/active/career"]')).toHaveAttribute('aria-current', 'page');
  });

  test("the Career panel's rail links back to the app's tabs", async ({ page }) => {
    await page.goto('/active/career');
    const apps = page.locator('.cp-rail-apps');
    await expect(apps).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the app' })).toBeHidden();
    await apps.getByRole('link', { name: 'Money', exact: true }).click();
    await expect(page).toHaveURL(/\/active#money$/);
    await expect(page.locator('.stage')).toHaveAttribute('data-tab', 'money');
  });
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the phone keeps its bottom nav, and the rail and header stay hidden', async ({ page }) => {
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.dk-rail')).toBeHidden();
    await expect(page.locator('.dk-header')).toBeHidden();
  });

  test("the Career panel keeps its bottom bar and its way back", async ({ page }) => {
    await page.goto('/active/career');
    await expect(page.locator('.cp-rail-apps')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Back to the app' })).toBeVisible();
  });
});
