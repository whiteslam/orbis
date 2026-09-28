import { test as base } from '@playwright/test';
import { expect, openApp, test } from '../support/fixtures';

test('home loads for a signed-in user without console errors', async ({ page, consoleErrors }) => {
  await openApp(page);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Expense', exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('sign out returns to login and protects home again', async ({ browser, userB }) => {
  // Sign in fresh as B so signing out does not end the shared session of A.
  const context = await browser.newContext({ storageState: userB.storageState });
  const page = await context.newPage();
  await openApp(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /sign out/i }).last().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  // Signed out, '/' is the public landing page rather than the app.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Expense', exact: true })).toHaveCount(0);
  await context.close();
});

base('signed-out home shows the landing page with a way to sign in', async ({ page }) => {
  await page.goto('/');
  await base.expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await base.expect(page.locator('a[href="/login"]').first()).toBeVisible();
  await base.expect(page.getByRole('navigation').getByRole('button', { name: 'Expense', exact: true })).toHaveCount(0);
});

base('invalid credentials show an error and stay on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody-orbis-qa@example.com');
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await base.expect(page.getByText(/didn['’]t work|temporarily unavailable|Too many/)).toBeVisible();
  await base.expect(page).toHaveURL(/\/login/);
});
