import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/providers/markets', () => ({ getFundNavs: async () => new Map(), getStockQuotes: async () => new Map() }));

const { getAccessToken, GrowwAuthError } = await import('@/lib/invest/groww');

const apiKey = 'K'.repeat(20);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// Groww issues a token only when the checksum was made from the right secret.
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const { checksum, timestamp } = JSON.parse(String(init?.body)) as { checksum: string; timestamp: string };
  return checksum === sha256(`right${timestamp}`)
    ? new Response(JSON.stringify({ token: 'T-owner' }), { status: 200 })
    : new Response(JSON.stringify({ message: 'invalid' }), { status: 401 });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAccessToken', () => {
  it('does not hand a cached token to the same key with a wrong secret', async () => {
    await expect(getAccessToken({ apiKey, apiSecret: 'right' })).resolves.toBe('T-owner');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(getAccessToken({ apiKey, apiSecret: 'wrong-secret' })).rejects.toBeInstanceOf(GrowwAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the cached token for the same key and secret', async () => {
    await getAccessToken({ apiKey: 'A'.repeat(20), apiSecret: 'right' });
    await getAccessToken({ apiKey: 'A'.repeat(20), apiSecret: 'right' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('always asks Groww when a fresh exchange is requested', async () => {
    await getAccessToken({ apiKey: 'B'.repeat(20), apiSecret: 'right' });
    await expect(getAccessToken({ apiKey: 'B'.repeat(20), apiSecret: 'right' }, { fresh: true })).resolves.toBe('T-owner');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
