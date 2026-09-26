import { expect, openApp, openTab, test } from '../support/fixtures';

// A save attempted while offline must fail visibly, keep what the user typed,
// and must not leave the page in a broken/unhandled-error state.
test('offline save keeps the draft and shows an error; retry works once online', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const text = `QA offline ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Profile');
  await page.getByRole('tab', { name: 'Journal' }).click();
  const editor = page.locator('.pf-editor');
  if (await page.getByRole('button', { name: 'Edit today’s entry' }).isVisible()) await page.getByRole('button', { name: 'Edit today’s entry' }).click();
  await editor.getByRole('radio', { name: /Okay/ }).click();
  await editor.getByRole('textbox').fill(text);

  await context.setOffline(true);
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(editor.getByRole('status')).toContainText(/offline|connection|couldn’t|could not|try again/i, { timeout: 15_000 });
  await expect(editor.getByRole('textbox')).toHaveValue(text);
  await expect(editor.getByRole('button', { name: /Save entry|Update entry/ })).toBeEnabled();

  await context.setOffline(false);
  await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
  await expect(page.locator('.pf-editor').getByText(text)).toBeVisible({ timeout: 15_000 });
  expect(pageErrors).toEqual([]);
});
