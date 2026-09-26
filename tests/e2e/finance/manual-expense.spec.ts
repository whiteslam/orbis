import { request as playwrightRequest } from '@playwright/test';
import { expect, openApp, openTab, test } from '../support/fixtures';
import { readUsers, supabaseAdmin } from '../support/env';

type CapturedAction = { url: string; headers: Record<string, string>; body: string };

async function countTransactions(userId: string, merchant: string) {
  const admin = supabaseAdmin();
  const { SUPABASE_SECRET_KEY: key } = process.env;
  void key;
  const response = await fetch(`${admin.url}/rest/v1/transactions?user_id=eq.${userId}&merchant=eq.${encodeURIComponent(merchant)}&select=id`, {
    headers: { apikey: (await import('../support/env')).loadEnv().SUPABASE_SECRET_KEY, authorization: `Bearer ${(await import('../support/env')).loadEnv().SUPABASE_SECRET_KEY}` },
  });
  return (await response.json() as unknown[]).length;
}

// Server Actions are POSTs carrying a `next-action` header; capture one to replay it.
function captureActions(page: import('@playwright/test').Page) {
  const actions: CapturedAction[] = [];
  page.on('request', (request) => {
    const headers = request.headers();
    if (request.method() === 'POST' && headers['next-action']) actions.push({ url: request.url(), headers, body: request.postData() ?? '' });
  });
  return actions;
}

test('manual expense: create → persists after reload → delete; double click creates one row', async ({ page, userA, consoleErrors }) => {
  const merchant = `QA Coffee ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Expense');
  await page.getByRole('button', { name: /^(Add manually|Add one now)$/ }).first().click();
  await page.getByLabel('Amount').fill('123.45');
  await page.getByRole('button', { name: 'Food & dining' }).click();
  await page.getByLabel(/Paid to/).fill(merchant);
  // Rapid double submission must not create two rows.
  const save = page.getByRole('button', { name: 'Save expense' });
  await save.dblclick();
  await expect(page.getByText('Expense saved.')).toBeVisible();
  await expect.poll(() => countTransactions(userA.id, merchant)).toBe(1);

  await page.reload();
  await openApp(page);
  await openTab(page, 'Expense');
  await expect(page.getByText(merchant)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  const row = page.locator('.finance-transaction', { hasText: merchant });
  await row.getByRole('button', { name: 'Delete transaction' }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => countTransactions(userA.id, merchant)).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('manual expense validation: bad amounts are rejected, nothing is saved', async ({ page, userA }) => {
  const merchant = `QA Invalid ${Date.now()}`;
  await openApp(page);
  await openTab(page, 'Expense');
  await page.getByRole('button', { name: /^(Add manually|Add one now)$/ }).first().click();
  const save = page.getByRole('button', { name: 'Save expense' });
  await expect(save).toBeDisabled(); // no amount yet
  await page.getByLabel(/Paid to/).fill(merchant);
  await page.getByLabel('Amount').fill('10');
  await save.click();
  await expect(page.getByText('Choose a category.')).toBeVisible();
  await page.getByRole('button', { name: 'Transport' }).click();
  // More than 2 decimals: the browser's own validation blocks submission.
  await page.getByLabel('Amount').fill('1.234');
  await save.click();
  expect(await page.getByLabel('Amount').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await page.getByLabel('Amount').fill('-5');
  await save.click();
  expect(await page.getByLabel('Amount').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(await countTransactions(userA.id, merchant)).toBe(0);
});

test('server actions refuse replayed requests without a session and across users', async ({ page, browser, userA, userB, baseURL }) => {
  const merchant = `QA Replay ${Date.now()}`;
  const actions = captureActions(page);
  await openApp(page);
  await openTab(page, 'Expense');
  await page.getByRole('button', { name: /^(Add manually|Add one now)$/ }).first().click();
  await page.getByLabel('Amount').fill('50');
  await page.getByRole('button', { name: 'Transport' }).click();
  await page.getByLabel(/Paid to/).fill(merchant);
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense saved.')).toBeVisible();
  const add = actions.find((action) => action.body.includes(merchant));
  expect(add, 'captured the add-expense action').toBeTruthy();

  // 1. Replay with no cookies at all: must not create a row.
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const replay = await anonymous.post(add!.url, { headers: { 'next-action': add!.headers['next-action'], 'content-type': add!.headers['content-type'], accept: 'text/x-component' }, data: add!.body });
  expect(replay.status()).toBeLessThan(500);
  await anonymous.dispose();
  expect(await countTransactions(userA.id, merchant)).toBe(1);

  // 2. User B replays A's delete for A's transaction id: A's row must survive.
  page.once('dialog', (dialog) => dialog.accept());
  const row = page.locator('.finance-transaction', { hasText: merchant });
  const deleteCapture = captureActions(page);
  const contextB = await browser.newContext({ storageState: readUsers().b.storageState });
  // Cancel A's own delete so we only learn the request shape; re-add afterwards is unnecessary.
  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => dialog.dismiss());
  await row.getByRole('button', { name: 'Delete transaction' }).click();
  expect(deleteCapture).toHaveLength(0); // dismissing the confirm sends nothing

  const idResponse = await fetch(`${supabaseAdmin().url}/rest/v1/transactions?user_id=eq.${userA.id}&merchant=eq.${encodeURIComponent(merchant)}&select=id`, {
    headers: { apikey: (await import('../support/env')).loadEnv().SUPABASE_SECRET_KEY, authorization: `Bearer ${(await import('../support/env')).loadEnv().SUPABASE_SECRET_KEY}` },
  });
  const [{ id }] = await idResponse.json() as Array<{ id: string }>;

  // Learn the delete action id from B's own UI, then aim it at A's id.
  const pageB = await contextB.newPage();
  const bActions = captureActions(pageB);
  await openApp(pageB);
  await openTab(pageB, 'Expense');
  await pageB.getByRole('button', { name: 'Add', exact: true }).click();
  await pageB.getByLabel('Amount').fill('5');
  await pageB.getByRole('button', { name: 'Transport' }).click();
  await pageB.getByLabel(/Paid to/).fill(`QA B ${Date.now()}`);
  await pageB.getByRole('button', { name: 'Save expense' }).click();
  await expect(pageB.getByText('Expense saved.')).toBeVisible();
  pageB.once('dialog', (dialog) => dialog.accept());
  await pageB.locator('.finance-transaction').first().getByRole('button', { name: 'Delete transaction' }).click();
  await expect.poll(() => bActions.filter((action) => action.body.match(/^\["[0-9a-f-]{36}"\]$/)).length).toBeGreaterThan(0);
  const del = bActions.find((action) => /^\["[0-9a-f-]{36}"\]$/.test(action.body))!;
  const cookies = (await contextB.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const attack = await fetch(del.url, { method: 'POST', headers: { 'next-action': del.headers['next-action'], 'content-type': del.headers['content-type'], accept: 'text/x-component', cookie: cookies }, body: JSON.stringify([id]) });
  expect(attack.status).toBeLessThan(500);
  await contextB.close();
  expect(await countTransactions(userA.id, merchant)).toBe(1);
  void userB;
});
