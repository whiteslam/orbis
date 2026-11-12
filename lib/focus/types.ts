// Shared shape for every tab's focal surface.
//
// The Field layout gives each screen one lifted object that says what is true
// and what to do about it, and demotes everything else to a hairline row. Each
// tab has its own composer; they all return these two shapes.

// Relative, so the unit tests can load this module under plain Node.
import { DEFAULT_PERSON_LOCALE } from '../locale/person.ts';
import { formatMoney } from '../locale/money.ts';

export type FocusTarget = 'finance' | 'health' | 'invest' | 'personal' | 'social' | 'career';

/**
 * The services a brief card can cite. Each one gets a small mark beside its
 * source line, so where a number came from is readable at a glance rather than
 * only in the wording.
 */
export type SourceId = 'open-meteo' | 'gmail' | 'apple-health' | 'groww' | 'orbis';

export type Focus = {
  /** Stable id for the rule that matched — useful for tests and analytics. */
  id: string;
  headline: string;
  /** Everything worth saying, including what an action costs. No separate caption. */
  body: string;
  /** In-app navigation. A tab's own screen passes its own control instead. */
  action: { label: string; target: FocusTarget } | null;
  /**
   * Where the claim came from, in the user's terms — "Gmail · 3 alerts · 2 min
   * ago". The Atlas brief prints it under the copy, so a statement about the
   * user's money or body always shows which connected source produced it.
   */
  source?: string;
};

export type QuietRow = {
  label: string;
  value: string;
  /** True when there is nothing there yet, so the value reads as absent, not zero. */
  empty: boolean;
  target: FocusTarget | null;
};

/** Money as the brief says it: whole units, Indian grouping, rupees unless told otherwise. */
export function money(amount: number, currency = DEFAULT_PERSON_LOCALE.currency) {
  return formatMoney(amount, currency, DEFAULT_PERSON_LOCALE.locale, { decimals: 0 });
}

export function count(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function percent(share: number) {
  return `${Math.round(share * 100)}%`;
}

export function whole(value: number) {
  return Math.round(value).toLocaleString('en-IN');
}

/** "24 Sept" in the person's zone. A bare YYYY-MM-DD is already a calendar date, so it is read as one. */
export function shortDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: iso.length === 10 ? 'UTC' : timeZone });
}
