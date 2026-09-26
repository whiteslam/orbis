// Shared shape for every tab's focal surface.
//
// The Field layout gives each screen one lifted object that says what is true
// and what to do about it, and demotes everything else to a hairline row. Each
// tab has its own composer; they all return these two shapes.

export type FocusTarget = 'finance' | 'health' | 'invest' | 'personal';

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

const TIME_ZONE = 'Asia/Kolkata';

export function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

export function money(amount: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-IN')}`;
  }
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

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TIME_ZONE });
}
