import { expect, openApp, openTab, test } from '../support/fixtures';

// Create → reload (data came from the database) → update/delete, through the real UI.

test('goal: create, persists after reload, update progress', async ({ page, consoleErrors }) => {
  const title = `QA goal ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Health');
  await page.getByLabel('What do you want to achieve?').fill(title);
  await page.getByLabel('Target', { exact: true }).fill('10');
  await page.getByLabel('Unit').fill('km');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByText(title)).toBeVisible();

  await page.reload();
  await openApp(page);
  await openTab(page, 'Health');
  const goal = page.locator('.goal-item', { hasText: title });
  await expect(goal).toBeVisible();
  await goal.getByLabel('Update progress').fill('4');
  await goal.getByRole('button', { name: 'Update' }).click();
  await expect(goal.getByText('40%')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('journal: mood is required, entry saves, persists, and can be edited', async ({ page, consoleErrors }) => {
  const text = `QA journal ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Journal' }).click();
  const editor = page.locator('.journal-today');
  await editor.getByRole('textbox').fill(text);
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(page.getByText('Pick how you’re feeling first.')).toBeVisible();
  await editor.getByRole('radio', { name: /Good/ }).click();
  await editor.getByRole('button', { name: '#fitness' }).click();
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(editor.getByText(text)).toBeVisible();

  await page.reload();
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Journal' }).click();
  await expect(page.locator('.journal-today').getByText(text)).toBeVisible();
  await expect(page.locator('.journal-streak')).toContainText('1 day');
  await page.getByRole('button', { name: 'Edit today’s entry' }).click();
  await page.locator('.journal-today').getByRole('textbox').fill(`${text} edited`);
  await page.locator('.journal-today').getByRole('button', { name: 'Update entry' }).click();
  await expect(page.locator('.journal-today').getByText(`${text} edited`)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('investment holding: add, persists, delete', async ({ page, consoleErrors }) => {
  const name = `QA Index Fund ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Invest');
  const form = page.locator('form', { hasText: 'Add a holding' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Units').fill('10');
  await form.getByLabel('Value per unit').fill('125.5');
  await form.getByRole('button', { name: 'Save holding' }).click();
  await expect(page.getByText('Holding added.')).toBeVisible();

  await page.reload();
  await openApp(page);
  await openTab(page, 'Invest');
  const holding = page.locator('.investment-holding', { hasText: name });
  await expect(holding).toBeVisible();
  await expect(page.locator('.invest-hero')).toContainText('1,255');
  page.once('dialog', (dialog) => dialog.accept());
  await holding.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(page.getByText('Holding removed.')).toBeVisible();
  await expect(holding).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('settings: home city and notification preferences save and persist', async ({ page, consoleErrors }) => {
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Home city').fill('Pune');
  await page.getByRole('button', { name: /^(Save|Change)$/ }).click();
  await expect(page.getByText(/Saved Pune/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('switch').check();
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
