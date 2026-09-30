import { expect, test } from '@playwright/test';

test('manifest is installable and the offline page renders', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose?.includes('maskable'))).toBe(true);
  // No tab shortcuts: the manifest is world-readable and each one would have
  // carried the app's own route. start_url is '/', which the proxy hands over to
  // the app for whoever is signed in, so an installed Orbis still opens into it.
  expect(manifest.shortcuts).toBeUndefined();
  expect(manifest.start_url).toBe('/');
  expect(JSON.stringify(manifest)).not.toContain('/active');
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto('/offline');
  expect(response!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/offline/i);
  expect(violations).toEqual([]);
});
