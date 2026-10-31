import { expect, openApp, openTab, test, TABS } from '../support/fixtures';

// Orbis's wallpaper (soft glows and a dot texture) stays behind every tab,
// glass stays on the floating chrome, and the text is the system font
// (docs/design/apple.md).
test('the wallpaper behind every tab, glass chrome, system font', async ({ page }) => {
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
  expect(chrome.font).toMatch(/^-apple-system, BlinkMacSystemFont, system-ui/);
});
