// Request rules for the Android phone endpoints (/api/device/*): pure functions
// the routes call before anything reaches the database.
//
// device_sync (supabase/migrations/202611120004_devices.sql) RAISES on a
// malformed item and rolls the whole sync back, heartbeat included. The phone
// treats a 400 as "drop this batch" but a 5xx as "retry forever", so parseSync
// refuses (with a message, the route turns it into a 400) everything the SQL
// would raise on. Keep the two in step when either changes.
//
// tests/fixtures/device-sync.json is the Kotlin-TypeScript contract: the
// phone's serializer is tested against the same file.

import { createHash, randomBytes } from 'node:crypto';

/** The wire names, exactly as the phone sends them and as the SQL checks them. */
export const SOURCES = [
  'test',
  'notifications',
  'calendar',
  'contacts',
  'calls',
  'health',
  'usage',
  'phone_state',
  'location',
] as const;
export type Source = (typeof SOURCES)[number];

export const MAX_SIGNALS = 100;
export const MAX_CONTENT_CHARS = 4000;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_ACTIVE_DEVICES = 10;
/** One row per source per day: 9 sources x 10 days. The phone sends today and a few days back. */
export const MAX_LEDGER_ROWS = SOURCES.length * 10;

const MAX_NAME_CHARS = 60;
const MAX_APP_VERSION_CHARS = 20;
const MAX_PUSH_TOKEN_CHARS = 4096;
const MAX_COUNT = 2_147_483_647; // Postgres integer
const FUTURE_MS = 24 * 60 * 60 * 1000; // 1 day
const PAST_MS = 400 * 24 * 60 * 60 * 1000; // 400 days

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z_]{0,39}$/;
const CREDENTIAL = /^Device ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// --- credential -------------------------------------------------------------

/** `Authorization: Device <uuid>.<43 base64url chars>`, or null. */
export function deviceCredential(header: string | null): { deviceId: string; secret: string } | null {
  if (!header) return null;
  const m = CREDENTIAL.exec(header);
  if (!m) return null;
  return { deviceId: m[1].toLowerCase(), secret: m[2] };
}

/** 32 random bytes as 43 base64url characters. Shown once, never stored. */
export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 as lowercase hex: what Postgres computes as encode(sha256(convert_to(s, 'UTF8')), 'hex'). */
export function secretHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

// --- shared helpers ---------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string Postgres text/jsonb can hold: no NUL, no lone surrogate. */
function storable(v: unknown): v is string {
  return typeof v === 'string' && !v.includes('\u0000') && !LONE_SURROGATE.test(v);
}

function parseBody(text: string): Obj | string {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return 'request body too large';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'body is not valid JSON';
  }
  return isObj(raw) ? raw : 'body must be a JSON object';
}

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function realDate(year: number, month: number, day: number): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

/** Epoch ms of a strict ISO-8601 timestamp with a zone, or null. */
function parseTimestamp(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = TIMESTAMP.exec(v);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (!realDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  if (m[9] !== undefined && (Number(m[9]) > 15 || Number(m[10]) > 59)) return null;
  // Only the first three fraction digits matter to a millisecond clock; trim so
  // every engine parses the rest the same way.
  const fraction = m[7] ? `.${m[7].slice(0, 3).padEnd(3, '0')}` : '';
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${fraction}${m[8]}`);
  return Number.isFinite(ms) ? ms : null;
}

function isSource(v: unknown): v is Source {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
}

// --- register ---------------------------------------------------------------

/** Body of POST /api/device/register. The name is trimmed and cut to 60 characters. */
export function parseRegister(text: string): { name: string; flavour: 'play' | 'direct'; appVersion: string } | string {
  const body = parseBody(text);
  if (typeof body === 'string') return body;

  if (!storable(body.name)) return 'name must be text';
  let name = body.name.trim().slice(0, MAX_NAME_CHARS);
  // Never leave half a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  name = name.trimEnd();
  if (!name) return 'name is required';

  if (body.flavour !== 'play' && body.flavour !== 'direct') return "flavour must be 'play' or 'direct'";

  const appVersion = body.appVersion;
  if (!storable(appVersion) || appVersion.length < 1 || appVersion.length > MAX_APP_VERSION_CHARS) {
    return `appVersion must be 1-${MAX_APP_VERSION_CHARS} characters`;
  }

  return { name, flavour: body.flavour, appVersion };
}

// --- sync -------------------------------------------------------------------

export type SyncInput = {
  meta: { appVersion?: string; pushToken?: string };
  sources: { source: Source; enabled: boolean }[];
  signals: { id: string; source: Source; kind: string; occurredAt: string; content: string }[];
  ledger: { day: string; source: Source; kept: number; dropped: number; actions: number }[];
};

function parseMeta(raw: unknown): SyncInput['meta'] | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return 'meta must be an object';
  const meta: SyncInput['meta'] = {};
  if (raw.appVersion !== undefined) {
    if (!storable(raw.appVersion) || raw.appVersion.length > MAX_APP_VERSION_CHARS) {
      return `meta.appVersion must be at most ${MAX_APP_VERSION_CHARS} characters`;
    }
    meta.appVersion = raw.appVersion;
  }
  if (raw.pushToken !== undefined) {
    // An empty token is allowed: it clears the stored one.
    if (!storable(raw.pushToken) || raw.pushToken.length > MAX_PUSH_TOKEN_CHARS) {
      return `meta.pushToken must be at most ${MAX_PUSH_TOKEN_CHARS} characters`;
    }
    meta.pushToken = raw.pushToken;
  }
  return meta;
}

function parseSources(raw: unknown): SyncInput['sources'] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'sources must be a list';
  if (raw.length > SOURCES.length) return `sources has more than ${SOURCES.length} entries`;
  const out: SyncInput['sources'] = [];
  for (const [i, item] of raw.entries()) {
    if (!isObj(item)) return `sources[${i}] must be an object`;
    if (!isSource(item.source)) return `sources[${i}].source is not a known source`;
    if (typeof item.enabled !== 'boolean') return `sources[${i}].enabled must be true or false`;
    out.push({ source: item.source, enabled: item.enabled });
  }
  return out;
}

function parseSignals(raw: unknown, now: Date): SyncInput['signals'] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'signals must be a list';
  if (raw.length > MAX_SIGNALS) return `signals has more than ${MAX_SIGNALS} items`;
  const earliest = now.getTime() - PAST_MS;
  const latest = now.getTime() + FUTURE_MS;
  const out: SyncInput['signals'] = [];
  // The same id twice in one batch is allowed: the SQL's "on conflict do
  // nothing" counts the second as a duplicate and carries on.
  for (const [i, item] of raw.entries()) {
    const at = `signals[${i}]`;
    if (!isObj(item)) return `${at} must be an object`;
    if (typeof item.id !== 'string' || !UUID.test(item.id)) return `${at}.id must be a UUID`;
    if (!isSource(item.source)) return `${at}.source is not a known source`;
    if (typeof item.kind !== 'string' || !KIND.test(item.kind)) return `${at}.kind must match [a-z][a-z_]{0,39}`;
    const when = parseTimestamp(item.occurredAt);
    if (when === null) return `${at}.occurredAt must be an ISO timestamp`;
    if (when < earliest || when > latest) return `${at}.occurredAt is outside the accepted window`;
    if (!storable(item.content) || item.content.length < 1 || item.content.length > MAX_CONTENT_CHARS) {
      return `${at}.content must be 1-${MAX_CONTENT_CHARS} characters of plain text`;
    }
    // Lowercase, as Postgres stores a uuid: the content is encrypted bound to this id, and the export decrypts with the stored one.
    out.push({ id: item.id.toLowerCase(), source: item.source, kind: item.kind, occurredAt: item.occurredAt as string, content: item.content });
  }
  return out;
}

function count(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;
}

function parseLedger(raw: unknown): SyncInput['ledger'] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'ledger must be a list';
  if (raw.length > MAX_LEDGER_ROWS) return `ledger has more than ${MAX_LEDGER_ROWS} rows`;
  const out: SyncInput['ledger'] = [];
  for (const [i, item] of raw.entries()) {
    const at = `ledger[${i}]`;
    if (!isObj(item)) return `${at} must be an object`;
    const d = typeof item.day === 'string' ? DAY.exec(item.day) : null;
    if (!d || !realDate(Number(d[1]), Number(d[2]), Number(d[3]))) return `${at}.day must be a real YYYY-MM-DD date`;
    if (!isSource(item.source)) return `${at}.source is not a known source`;
    const { kept, dropped, actions } = item;
    if (!count(kept)) return `${at}.kept must be an integer from 0 to ${MAX_COUNT}`;
    if (!count(dropped)) return `${at}.dropped must be an integer from 0 to ${MAX_COUNT}`;
    if (!count(actions)) return `${at}.actions must be an integer from 0 to ${MAX_COUNT}`;
    out.push({ day: item.day as string, source: item.source, kept, dropped, actions });
  }
  return out;
}

/**
 * Body of POST /api/device/signals. Returns the cleaned input (unknown keys
 * dropped) or a message for a 400. `now` is passed in so tests can pin the clock.
 */
export function parseSync(text: string, now: Date): SyncInput | string {
  const body = parseBody(text);
  if (typeof body === 'string') return body;

  const meta = parseMeta(body.meta);
  if (typeof meta === 'string') return meta;
  const sources = parseSources(body.sources);
  if (typeof sources === 'string') return sources;
  const signals = parseSignals(body.signals, now);
  if (typeof signals === 'string') return signals;
  const ledger = parseLedger(body.ledger);
  if (typeof ledger === 'string') return ledger;

  return { meta, sources, signals, ledger };
}
