import { expect, openApp, openTab, test, TABS } from '../support/fixtures';

// docs/design/apple.md: a plain grouped background behind every tab, glass
// only on the floating chrome, and the system font rather than a web font.
test('Apple look: plain background on every tab, glass chrome, system font', async ({ page }) => {
  await openApp(page);
  for (const tab of TABS) {
    await openTab(page, tab);
    await expect(page.locator('.glass-wall, .glass-blob')).toHaveCount(0);
  }
  const chrome = await page.evaluate(() => {
    const nav = getComputedStyle(document.querySelector('.bottom-nav')!);
    return { blur: nav.backdropFilter || nav.getPropertyValue('-webkit-backdrop-filter'), font: getComputedStyle(document.body).fontFamily };
  });
  expect(chrome.blur).toContain('blur');
  expect(chrome.font).toMatch(/^-apple-system, BlinkMacSystemFont, system-ui/);
  expect(chrome.font.toLowerCase()).not.toContain('dm sans');
});
