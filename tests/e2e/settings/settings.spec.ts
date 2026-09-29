import { expect, openApp, openSettings, openTab, test, TABS } from '../support/fixtures';

test('Settings opens from every tab and closes when a tab is tapped or Escape is pressed', async ({ page, consoleErrors }) => {
  await openApp(page);
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  for (const tab of TABS) {
    await openTab(page, tab);
    await openSettings(page);
    await openTab(page, tab);
    await expect(sheet).toBeHidden();
  }
  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('Settings has every section, one Connections list, and security controls', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  for (const name of ['You', 'Connections', 'AI & privacy', 'Notifications', 'Your day', 'Security', 'Your data']) {
    await expect(sheet.getByRole('heading', { name, exact: true })).toHaveCount(1);
  }
  await expect(sheet.getByText('Google', { exact: true })).toHaveCount(1);
  await expect(sheet.getByText('Read-only').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Lock now' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Change PIN' }).click();
  await expect(sheet.getByLabel(/New \d-digit PIN/)).toBeVisible();
});
