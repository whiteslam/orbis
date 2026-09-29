import { expect, openApp, openTab, test } from '../support/fixtures';

// A save attempted while offline must fail visibly, keep what the user typed,
// and must not leave the page in a broken/unhandled-error state.
test('offline save keeps the draft and shows an error; retry works once online', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const text = `QA offline ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Journal');
  const editor = page.locator('.pf-editor');
  const editButton = page.getByRole('button', { name: 'Edit today’s entry' });
  // Journal now loads as its own tab (a dynamic import), so the editor or the
  // saved view of today's entry may not have rendered yet right after the tab
  // switch. Wait for whichever of the two shows up before deciding which one it is.
  await expect(editButton.or(editor.getByRole('radiogroup'))).toBeVisible();
  if (await editButton.isVisible()) await editButton.click();
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
