import { request as playwrightRequest } from '@playwright/test';
import { expect, test } from '../support/fixtures';

const noCookies = { cookies: [], origins: [] };

test.describe('GET route handlers', () => {
  test('weather and currency require a session (401 JSON, no redirect, no data)', async ({ baseURL }) => {
    const anonymous = await playwrightRequest.newContext({ baseURL, storageState: noCookies });
    for (const path of ['/api/weather?lat=18.52&lon=73.86', '/api/weather', '/api/currency?base=INR&symbols=USD']) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(Object.keys(body)).toEqual(['error']);
    }
    await anonymous.dispose();
  });

  test('weather validates coordinates and answers a signed-in user', async ({ request }) => {
    for (const bad of ['lat=abc&lon=1', 'lat=91&lon=0', 'lat=0&lon=181', 'lat=&lon=', 'lat=1e2&lon=1', 'lat=0x10&lon=1']) {
      expect((await request.get(`/api/weather?${bad}`)).status(), bad).toBe(400);
    }
    // No saved city yet is a normal state (200), not an error.
    const saved = await request.get('/api/weather');
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ needsCity: true });

    const live = await request.get('/api/weather?lat=18.52&lon=73.86');
    expect([200, 503]).toContain(live.status());
    const body = await live.json();
    if (live.status() === 200) {
      // rainProbability was a single number: the wettest hour left in the day,
      // printed as though it were the chance right now. It is now an outlook
      // whose peak always carries the hour it refers to.
      expect(body).toEqual(expect.objectContaining({
        temperature: expect.any(Number),
        feelsLike: expect.any(Number),
        condition: expect.any(String),
        rainingNow: expect.any(Boolean),
        rain: expect.objectContaining({ soon: expect.any(Number) }),
      }));
      if (body.rain.peak !== null) {
        expect(body.rain.peak).toEqual({ probability: expect.any(Number), hour: expect.any(String) });
      }
      expect(Object.keys(body)).not.toContain('hourly');
    } else {
      expect(body.error).not.toMatch(/api\.open-meteo|stack|Error:/);
    }
  });

  test('currency validates codes and returns only requested rates', async ({ request }) => {
    for (const bad of ['base=XXX&symbols=INR', 'base=USD&symbols=', 'base=USD&symbols=INR,ZZZ', "base=US'D&symbols=INR"]) {
      expect((await request.get(`/api/currency?${bad}`)).status(), bad).toBe(400);
    }
    const response = await request.get('/api/currency?base=INR&symbols=USD,EUR');
    expect([200, 503]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(Object.keys(body.rates).sort()).toEqual(['EUR', 'USD']);
      expect(body.rates.USD).toBeGreaterThan(0);
    }
  });

  test('Google sign-in start refuses signed-out users and never leaks state', async ({ baseURL }) => {
    const anonymous = await playwrightRequest.newContext({ baseURL, storageState: noCookies });
    const response = await anonymous.get('/auth/gmail/start', { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location).not.toContain('accounts.google.com');
    await anonymous.dispose();
  });

  test('Google callback rejects forged state', async ({ request }) => {
    const response = await request.get('/auth/gmail/callback?state=forged&code=abc', { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.headers().location).toMatch(/gmail=error/);
  });

  test('unsupported methods are rejected', async ({ request }) => {
    expect((await request.post('/api/weather?lat=1&lon=1')).status()).toBe(405);
    expect((await request.delete('/api/currency')).status()).toBe(405);
  });
});
