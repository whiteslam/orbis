/**
 * Reading a model's JSON reply. Pure and client-safe.
 *
 * Every feature that asks a model for JSON reads the answer the same way: take
 * off a Markdown fence if the model added one, parse, and treat anything that
 * isn't the expected shape as no answer. The reply is data, never trusted, so
 * each reader here drops what it can't use instead of throwing.
 */

/** The reply without a Markdown code fence around it, if the model added one. */
export function unfence(reply: string): string {
  let body = reply.trim();
  if (body.startsWith('```')) {
    body = body.slice(3);
    if (body.slice(0, 4).toLowerCase() === 'json') body = body.slice(4);
    body = body.trimStart();
  }
  if (body.endsWith('```')) body = body.slice(0, -3).trimEnd();
  return body;
}

function parsed(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * The JSON value in a model's reply, or null. Tolerates a fence and, for an
 * object, a sentence around it ("Here you go: {…}"); the router already
 * unfences, but a reply re-parsed later may not have gone through it.
 */
export function readJson(reply: string): unknown {
  const body = unfence(reply);
  const whole = parsed(body);
  if (whole.ok) return whole.value;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const inner = parsed(body.slice(start, end + 1));
  return inner.ok ? inner.value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON object in a model's reply, or null for anything else (an array, a bare value, broken JSON). */
export function readJsonObject(reply: string): Record<string, unknown> | null {
  const value = readJson(reply);
  return isRecord(value) ? value : null;
}

/** A trimmed, single-spaced string capped at `max`, or '' for anything else. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.split(/\s+/).filter(Boolean).join(' ').slice(0, max).trim();
}

/** cleanText, but null instead of ''. */
export function cleanNullable(value: unknown, max: number): string | null {
  return cleanText(value, max) || null;
}

/**
 * Text whose line breaks matter (an email body, a reply draft): trimmed and
 * capped, lines kept, or null when empty or not a string.
 */
export function cleanBlock(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, max).trim() || null;
}

/** Unique non-empty cleaned strings, at most `maxItems`, each at most `maxLength`. */
export function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** A finite number within [min, max] (rounded when `integer`), else null. Numeric strings count. */
export function cleanNumber(value: unknown, min: number, max: number, integer = false): number | null {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) return null;
  return integer ? Math.round(number) : number;
}
