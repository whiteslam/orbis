import { expect, openApp, test } from '../support/fixtures';

test('the setup checklist opens the right Settings section and stays hidden once hidden', async ({ page }) => {
  await openApp(page);
  const list = page.getByRole('region', { name: 'Set up Orbis' });
  // Test users start with AI off, so that step is always present.
  await list.getByRole('button', { name: /Turn on AI/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await expect(sheet.getByRole('heading', { name: 'AI & privacy' })).toBeInViewport();
  await sheet.getByRole('button', { name: 'Close settings' }).click();

  await list.getByRole('button', { name: 'Hide' }).click();
  await expect(list).toBeHidden();
  await page.reload();
  await openApp(page);
  await expect(page.getByRole('region', { name: 'Set up Orbis' })).toBeHidden();
});
