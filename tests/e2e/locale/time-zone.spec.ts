import { expect, openApp, openTab, test } from '../support/fixtures';
import { supabaseAdmin } from '../support/env';
import { localDate } from '../../../lib/locale/dates';

// A person's own time zone decides which day a journal entry is filed under,
// in the browser (the editor's "today") and on the server (which checks it).
// Run against staging only: it changes the test user's settings.

const ZONE = 'America/Los_Angeles';

test('journal: an entry is filed under the day in the person’s own time zone', async ({ page, consoleErrors, userA }) => {
  const admin = supabaseAdmin();
  const [before] = await admin.selectRows('user_settings', `select=*&user_id=eq.${userA.id}`);
  await admin.upsertRow('user_settings', { user_id: userA.id, timezone: ZONE, currency: 'USD', locale: 'en-US', onboarded_at: new Date().toISOString() });
  try {
    // Start from nothing written on either side of the date line, so the editor is empty.
    const laToday = localDate(new Date(), ZONE);
    const indiaToday = localDate(new Date(), 'Asia/Kolkata');
    await admin.deleteRows('journal_entries', `user_id=eq.${userA.id}&entry_date=in.(${laToday},${indiaToday})`);

    const text = `QA zone ${Date.now()}`;
    await openApp(page);
    await openTab(page, 'Journal');
    const editor = page.locator('.pf-editor');
    await editor.getByRole('radio', { name: /Good/ }).click();
    await editor.getByRole('textbox').fill(text);
    await editor.getByRole('button', { name: /Save entry|Update entry/ }).click();
    await expect(page.locator('.pf-entry-view').getByText(text)).toBeVisible();

    const rows = await admin.selectRows<{ entry_date: string }>('journal_entries', `select=entry_date&user_id=eq.${userA.id}&body=eq.${encodeURIComponent(text)}`);
    expect(rows).toHaveLength(1);
    // Allow for the run crossing midnight in Los Angeles between the two reads.
    expect([laToday, localDate(new Date(), ZONE)]).toContain(rows[0].entry_date);
    expect(consoleErrors).toEqual([]);
  } finally {
    if (before) await admin.upsertRow('user_settings', before);
    else await admin.deleteRows('user_settings', `user_id=eq.${userA.id}`);
  }
});
