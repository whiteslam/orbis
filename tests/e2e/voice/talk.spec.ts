import { loadEnv } from '../support/env';
import { expect, openApp, openTab, test } from '../support/fixtures';

// Needs SARVAM_API_KEY in the environment the app is built and served with;
// without it the mic is hidden by design and there is nothing to test.
test.skip(!loadEnv().SARVAM_API_KEY?.trim(), 'Voice is not configured');

test('the mic is on every tab and opens and closes the talk panel', async ({ page, consoleErrors }) => {
  await openApp(page);
  const mic = page.getByRole('button', { name: 'Talk to Orbis' });
  await expect(mic).toBeVisible();
  await openTab(page, 'Health');
  await expect(mic).toBeVisible();

  await mic.click();
  const panel = page.getByRole('region', { name: 'Talk to Orbis' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/any Indian language/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Speak' })).toBeEnabled();

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(mic).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
