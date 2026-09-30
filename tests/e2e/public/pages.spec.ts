import { expect, test } from '@playwright/test';

for (const [path, heading] of [['/', /one calm page/i], ['/privacy', /privacy/i], ['/terms', /terms/i], ['/support', /support/i], ['/delete-account', /delete/i]] as const) {
  test(`${path} renders for signed-out visitors`, async ({ page }) => {
    // The waitlist carries its own CSP obligations (Task 2's headers spec only covers /login):
    // no inline script runs without the request's nonce, so no violation should ever be logged.
    const violations: string[] = [];
    if (path === '/') page.on('console', (message) => { if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text()); });
    const response = await page.goto(path);
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByRole('link', { name: 'Privacy' }).first()).toBeVisible();
    if (path === '/') expect(violations).toEqual([]);
  });
}
test('robots and sitemap are served', async ({ request }) => {
  expect(await (await request.get('/robots.txt')).text()).toMatch(/Sitemap:/);
  expect(await (await request.get('/sitemap.xml')).text()).toMatch(/\/privacy/);
});
test('auth pages are not indexed', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
