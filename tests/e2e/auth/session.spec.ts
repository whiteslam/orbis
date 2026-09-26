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
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

base('protected home redirects to login when signed out', async ({ page }) => {
  await page.goto('/');
  await base.expect(page).toHaveURL(/\/login/);
});

base('invalid credentials show an error and stay on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody-orbis-qa@example.com');
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await base.expect(page.getByText(/did not match|temporarily unavailable|Too many/)).toBeVisible();
  await base.expect(page).toHaveURL(/\/login/);
});
