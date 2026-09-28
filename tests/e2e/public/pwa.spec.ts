import { expect, test } from '@playwright/test';

test('manifest is installable and the offline page renders', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose?.includes('maskable'))).toBe(true);
  expect(manifest.shortcuts.length).toBeGreaterThan(0);
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto('/offline');
  expect(response!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/offline/i);
  expect(violations).toEqual([]);
});
