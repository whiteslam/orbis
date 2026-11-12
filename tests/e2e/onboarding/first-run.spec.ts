import { expect, test } from '../support/fixtures';
import { supabaseAdmin, TEST_PIN } from '../support/env';

// First run: someone with no user_settings row walks through onboarding,
// switches Social off, and lands on Today without a Social tab.
// Run against staging only: it rewrites the test user's settings, profile and
// notification zone, and puts each back afterwards.

// The browser's zone prefills the place step: India gets INR.
test.use({ timezoneId: 'Asia/Kolkata' });

type Row = Record<string, unknown>;

test('onboarding: a new person chooses their modules and lands on Today without Social', async ({ page, consoleErrors, userA }) => {
  const admin = supabaseAdmin();
  const own = `user_id=eq.${userA.id}`;
  const [settingsBefore] = await admin.selectRows<Row>('user_settings', `select=*&${own}`);
  const [profileBefore] = await admin.selectRows<Row>('user_personal_profiles', `select=*&${own}`);
  const [notifyBefore] = await admin.selectRows<Row>('notification_preferences', `select=*&${own}`);
  // No settings row is what makes this person new.
  await admin.deleteRows('user_settings', own);
  try {
    await page.goto('/active');
    const first = page.getByRole('heading', { name: 'What should Orbis call you?' });
    const pin = page.getByLabel('Enter your PIN');
    const password = page.getByLabel('Password', { exact: true });
    await expect(first.or(pin).or(password)).toBeVisible({ timeout: 30_000 });
    if (await pin.isVisible()) await pin.fill(TEST_PIN);
    else if (await password.isVisible()) {
      await password.fill(userA.password);
      await page.getByRole('button', { name: 'Unlock' }).click();
    }
    await expect(first).toBeVisible({ timeout: 30_000 });
    // Onboarding is the whole screen: no tabs yet.
    await expect(page.getByRole('navigation')).toHaveCount(0);

    // 1. Name.
    await page.getByLabel('Name to use').fill('QA First Run');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 2. Time zone and currency, prefilled from the browser.
    await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeFocused();
    await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Kolkata');
    await expect(page.getByLabel('Currency')).toHaveValue('INR');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 3. Modules: all ticked; untick Social.
    await expect(page.getByRole('heading', { name: 'What do you want to keep track of?' })).toBeFocused();
    for (const name of ['Money', 'Health', 'Journal', 'Social', 'Career']) {
      await expect(page.getByRole('checkbox', { name: new RegExp(`^${name}`) })).toBeChecked();
    }
    await page.getByRole('checkbox', { name: /^Social/ }).uncheck();
    await page.getByRole('button', { name: 'Continue' }).click();

    // 4. AI: off until turned on, with the same disclosure as Settings.
    await expect(page.getByRole('heading', { name: 'Use AI features?' })).toBeFocused();
    await expect(page.getByRole('switch', { name: 'Use AI features' })).not.toBeChecked();
    await expect(page.getByText('When it is on, each feature sends only what it needs, and only when it runs:')).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();

    // Today, and no Social tab anywhere in the navigation.
    const nav = page.getByRole('navigation');
    await expect(nav.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.stage')).toHaveAttribute('data-tab', 'today');
    await expect(nav.getByRole('button', { name: 'Money', exact: true }).or(nav.getByRole('link', { name: 'Money', exact: true })).first()).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Social', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Social', exact: true })).toHaveCount(0);

    const [saved] = await admin.selectRows<{ timezone: string; currency: string; modules: string[]; onboarded_at: string | null }>('user_settings', `select=timezone,currency,modules,onboarded_at&${own}`);
    expect(saved.timezone).toBe('Asia/Kolkata');
    expect(saved.currency).toBe('INR');
    expect(saved.modules).toEqual(['money', 'health', 'journal', 'career']);
    expect(saved.onboarded_at).not.toBeNull();

    // A link to the switched-off tab opens Today instead.
    await page.goto('/active#social');
    await expect(nav.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.stage')).toHaveAttribute('data-tab', 'today');
    expect(consoleErrors).toEqual([]);
  } finally {
    if (settingsBefore) await admin.upsertRow('user_settings', settingsBefore);
    else await admin.deleteRows('user_settings', own);
    if (profileBefore) await admin.upsertRow('user_personal_profiles', profileBefore);
    else await admin.deleteRows('user_personal_profiles', own);
    if (notifyBefore) await admin.upsertRow('notification_preferences', notifyBefore);
  }
});
