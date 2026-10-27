/**
 * Career: the one way the job sources call out. Never throws: a network
 * error, a non-2xx reply, a timeout or unreadable JSON all come back as null,
 * so one failing source never stops the others.
 */

export const USER_AGENT = 'Orbis/1.0 (personal job assistant)';

export type GetOptions = { headers?: Record<string, string>; timeoutMs?: number };

async function get(url: string, accept: string, { headers, timeoutMs = 10_000 }: GetOptions) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** The body as text, or null on any failure. */
export async function getText(url: string, options: GetOptions = {}): Promise<string | null> {
  return get(url, 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8', options);
}

/** The body parsed as JSON, or null on any failure. The shape is the caller's to check. */
export async function getJson(url: string, options: GetOptions = {}): Promise<unknown> {
  const body = await get(url, 'application/json', options);
  if (body === null) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
