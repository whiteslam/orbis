import { expect, openApp, openTab, test } from '../support/fixtures';

// Create → reload (data came from the database) → update/delete, through the real UI.

test('journal: mood is required, entry saves, persists, and can be edited', async ({ page, consoleErrors }) => {
  const text = `QA journal ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Journal' }).click();
  const editor = page.locator('.pf-editor');
  await editor.getByRole('textbox').fill(text);
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(page.getByText('Pick how you’re feeling first.')).toBeVisible();
  await editor.getByRole('radio', { name: /Good/ }).click();
  await editor.getByRole('button', { name: '#fitness' }).click();
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(page.locator('.pf-entry-view').getByText(text)).toBeVisible();

  await page.reload();
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Journal' }).click();
  await expect(page.locator('.pf-entry-view').getByText(text)).toBeVisible();
  await expect(page.locator('.pf-streak')).toContainText('1 day');
  await page.getByRole('button', { name: 'Edit today’s entry' }).click();
  await page.locator('.pf-editor').getByRole('textbox').fill(`${text} edited`);
  await page.locator('.pf-editor').getByRole('button', { name: 'Update entry' }).click();
  await expect(page.locator('.pf-entry-view').getByText(`${text} edited`)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('settings: home city and notification preferences save and persist', async ({ page, consoleErrors }) => {
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Home city').fill('Pune');
  await page.getByRole('button', { name: /^(Save|Change)$/ }).click();
  await expect(page.getByText(/Saved Pune/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('switch', { name: 'Daily notifications' }).check();
  await page.getByLabel('Lunch notification').uncheck();
  await page.getByRole('button', { name: 'Save notification settings' }).click();
  await expect(page.getByText('Notification settings saved.')).toBeVisible();

  await page.reload();
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText(/Weather uses Pune/)).toBeVisible();
  await expect(page.getByRole('switch')).toBeChecked();
  await expect(page.getByLabel('Lunch notification')).not.toBeChecked();

  // The saved city now drives the Home weather card (no browser location in tests).
  await openTab(page, 'Home');
  await expect(page.locator('.fd-weather, .fd-weather-quiet')).toContainText(/°|unavailable|Checking/);
  expect(consoleErrors).toEqual([]);
});
