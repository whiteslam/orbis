import { expect, openApp, openTab, test, TABS } from '../support/fixtures';

test('Glass: wallpaper behind every tab, frosted chrome, Figtree text', async ({ page }) => {
  await openApp(page);
  for (const tab of TABS) {
    await openTab(page, tab);
    await expect(page.locator('.glass-wall')).toHaveCount(1);
  }
  const chrome = await page.evaluate(() => {
    const nav = getComputedStyle(document.querySelector('.bottom-nav')!);
    return { blur: nav.backdropFilter || nav.getPropertyValue('-webkit-backdrop-filter'), font: getComputedStyle(document.body).fontFamily };
  });
  expect(chrome.blur).toContain('blur');
  expect(chrome.font.toLowerCase()).toContain('figtree');
});
