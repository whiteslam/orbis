// Removes what must never leave Orbis in an error report: request bodies, cookies,
// query strings (auth codes and tokens ride there) and credential headers. Pure and
// structural, so it has no Sentry import and can be tested on its own.

type RequestShape = {
  url?: string;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, string>;
};

const DROPPED_HEADERS = new Set(['cookie', 'authorization']);

export function scrubEvent<E extends object>(event: E): E {
  const request = (event as { request?: RequestShape }).request;
  if (!request) return event;

  const scrubbed: RequestShape = { ...request };
  delete scrubbed.data;
  delete scrubbed.cookies;
  delete scrubbed.query_string;

  if (typeof scrubbed.url === 'string') scrubbed.url = scrubbed.url.split(/[?#]/)[0];
  if (scrubbed.headers) {
    scrubbed.headers = Object.fromEntries(Object.entries(scrubbed.headers).filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase())));
  }
  return { ...event, request: scrubbed };
}
