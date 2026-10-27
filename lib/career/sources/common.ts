/**
 * Career: small readers every source parser shares. Pure and client-safe.
 *
 * A source's reply is data we don't control, so every field is read through
 * one of these and anything of the wrong type becomes empty, never a throw.
 */
import type { NormalizedJob, SalaryPeriod, WatchedCompany } from '../types.ts';
import { clipText, htmlToText } from '../text.ts';

export type Raw = Record<string, unknown>;
export type Salary = NonNullable<NormalizedJob['salary']>;

/** Descriptions are capped here (see NormalizedJob.description). */
export const MAX_DESCRIPTION = 20_000;

export function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A trimmed string, a number as text, or ''. */
export function str(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** A finite number from a number or numeric string, else null. */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** An ISO timestamp from epoch seconds or milliseconds, or any date string Date can read. */
export function toIso(value: unknown): string | null {
  let date: Date | null = null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Below 1e12 it can only be seconds (1e12 ms is 2001).
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === 'string' && value.trim()) {
    date = new Date(value.trim());
  }
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** A description as plain text capped at 20 000 characters, or null when there is none. */
export function toDescription(html: string, isHtml = true): string | null {
  const text = isHtml ? htmlToText(html) : html.trim();
  return text ? clipText(text, MAX_DESCRIPTION) : null;
}

/** True when any of the texts says the job is remote and doesn't say it isn't. */
export function looksRemote(...texts: Array<string | null | undefined>): boolean {
  const all = texts.filter(Boolean).join(' ').toLowerCase();
  if (!all) return false;
  for (const no of ['not remote', 'no remote', 'non-remote', 'onsite only', 'on-site only']) {
    if (all.includes(no)) return false;
  }
  return /\bremote\b/.test(all) || all.includes('work from home') || /\bwfh\b/.test(all) || all.includes('anywhere in the world');
}

/** A salary from numbers a source gave, or null when there is no figure or no currency. */
export function salaryOf(min: number | null, max: number | null, currency: string, period: SalaryPeriod): Salary | null {
  const low = min !== null && min > 0 ? min : null;
  const high = max !== null && max > 0 ? max : null;
  if ((low === null && high === null) || !currency) return null;
  if (low !== null && high !== null && low > high) return { min: high, max: low, currency: currency.toUpperCase(), period };
  return { min: low, max: high, currency: currency.toUpperCase(), period };
}

/** A period from the words sources use ('annual', 'per-hour-wage', '1 MONTH', 'monthly'…). Defaults to a year. */
export function periodOf(value: unknown): SalaryPeriod {
  const text = str(value).toLowerCase();
  if (text.includes('hour')) return 'hour';
  if (text.includes('month')) return 'month';
  return 'year';
}

/** "acme-corp" as "Acme Corp", for sources that only give the slug. */
export function titleFromSlug(slug: string): string {
  return slug.split(/[-_]/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/** Every watched company on one ATS, loaded side by side; a failing one adds nothing. */
export async function eachWatched(
  watchlist: WatchedCompany[],
  ats: WatchedCompany['ats'],
  load: (company: WatchedCompany) => Promise<NormalizedJob[]>,
): Promise<NormalizedJob[]> {
  const picked = watchlist.filter((company) => company.ats === ats && company.slug.trim());
  const lists = await Promise.all(picked.map((company) => load(company).catch(() => [])));
  return lists.flat();
}
