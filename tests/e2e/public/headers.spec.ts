import { expect, test } from '@playwright/test';

test('login page sends the security headers and raises no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto('/login');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toMatch(/nonce-/);
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
  // The mode toggle is also named "Sign in"; the form's submit button is the one that matters.
  await expect(page.locator('form').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
