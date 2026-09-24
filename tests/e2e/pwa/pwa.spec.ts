import { request as playwrightRequest } from '@playwright/test';
import { expect, test } from '../support/fixtures';

const noCookies = { cookies: [], origins: [] };

test('web app manifest is valid and installable', async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: noCookies });
  const response = await anonymous.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.start_url).toBeTruthy();
  expect(['standalone', 'fullscreen']).toContain(manifest.display);
  expect(manifest.theme_color).toMatch(/^#/);
  expect(manifest.background_color).toMatch(/^#/);
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose?.includes('maskable'))).toBe(true);
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const image = await anonymous.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()['content-type']).toMatch(/image\//);
  }
  await anonymous.dispose();
});

test('service worker is served as JavaScript and registers', async ({ page, baseURL }) => {
  const response = await page.request.get(`${baseURL}/sw.js`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/javascript/);
  await page.goto('/login');
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return registration.active?.state ?? registration.installing?.state ?? 'none';
  });
  expect(['activated', 'activating', 'installed', 'installing']).toContain(registered);
});

test('login page has the mobile app meta tags', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: noCookies });
  const page = await context.newPage();
  await page.goto('/login');
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).toContain('width=device-width');
  expect(viewport).toContain('viewport-fit=cover');
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?![0-9])/); // pinch-zoom stays available for accessibility
  await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
  await expect(page.locator('link[rel=apple-touch-icon], link[rel="apple-touch-icon"]').first()).toBeAttached();
  await context.close();
});
