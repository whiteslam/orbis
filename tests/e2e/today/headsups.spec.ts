import { expect, openApp, openSettings, test } from '../support/fixtures';

const HEADSUP = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'money.logging_gap',
  urgency: 'normal',
  title: 'Nothing logged for 5 days',
  body: 'You usually add spending most days.',
  action: { type: 'open_spending_entry', category: 'Food & dining' },
  actionLabel: 'Add a spend',
  wordedBy: 'rules',
  createdAt: '2026-09-30T00:30:00Z',
};

test('a heads-up shows on Today and its step opens a prefilled spending form', async ({ page }) => {
  await page.route('**/api/home/headsups*', (route) => route.fulfill({ json: { state: 'ready', headsups: [HEADSUP], disabledKinds: [], offerOff: [] } }));
  await openApp(page);
  const card = page.getByRole('region', { name: 'Heads-ups' });
  await expect(card.getByText('Nothing logged for 5 days')).toBeVisible();
  await expect(card.getByText('From your spending · worded by Orbis')).toBeVisible();
  await card.getByRole('button', { name: 'Add a spend' }).click();
  await expect(page.getByRole('button', { name: 'Food & dining' })).toHaveAttribute('aria-pressed', 'true');
});

test('Settings lists the heads-up checks', async ({ page }) => {
  await page.route('**/api/home/headsups*', (route) => route.fulfill({ json: { state: 'ready', headsups: [], disabledKinds: ['money.logging_gap'], offerOff: [] } }));
  await openApp(page);
  await openSettings(page);
  await expect(page.getByRole('switch', { name: 'Days with no spending logged' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'A spend much bigger than usual' })).toBeChecked();
});
