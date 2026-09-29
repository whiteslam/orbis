import { loadEnv } from '../support/env';
import { expect, openApp, openTab, test } from '../support/fixtures';

const voice = Boolean(loadEnv().SARVAM_API_KEY?.trim());

test('Ask Orbis is on every tab and answers a typed question, voice or not', async ({ page, consoleErrors }) => {
  await openApp(page);
  // exact: true — the setup checklist's "Turn on AI for the brief and Ask
  // Orbis" line is also a button, and its accessible name contains "Ask
  // Orbis" as a substring, which the default loose match picked up too,
  // intermittently (whenever the checklist happened to be visible).
  const button = page.getByRole('button', { name: 'Ask Orbis', exact: true });
  await expect(button).toBeVisible();
  await openTab(page, 'Health');
  await expect(button).toBeVisible();

  await button.click();
  const panel = page.getByRole('region', { name: 'Ask Orbis' });
  await expect(panel.getByRole('button', { name: 'Journal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Speak' })).toHaveCount(voice ? 1 : 0);

  // Test users have AI off, so the answer is the consent message: proof the typed path reached the server.
  await panel.getByLabel('Type a question').fill('How much did I spend this week?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText(/AI features are off|No private AI model/);

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
