/**
 * The choices offered for time zone and currency, and the first guess from
 * the browser. Pure and client-safe.
 */

import { canonicalTimeZone, DEFAULT_PERSON_LOCALE, isValidTimeZone } from '@/lib/locale/person';

/** Shown first in the currency list; the rest follow alphabetically. */
export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'];

/** A first guess from the browser's zone: that zone, and INR in India, else USD. India's defaults when the zone is missing or unknown. */
export function guessFromBrowser(browserZone: string | undefined): { timeZone: string; currency: string } {
  if (!browserZone || !isValidTimeZone(browserZone)) return { timeZone: DEFAULT_PERSON_LOCALE.timeZone, currency: DEFAULT_PERSON_LOCALE.currency };
  const timeZone = canonicalTimeZone(browserZone);
  return { timeZone, currency: timeZone === 'Asia/Kolkata' ? 'INR' : 'USD' };
}

/** Every currency the runtime knows, the common ones first, each once. */
export function currencyOptions(): string[] {
  return [...new Set([...COMMON_CURRENCIES, ...Intl.supportedValuesOf('currency')])];
}

/** Every time zone the runtime knows, by its current name, plus UTC and the one already chosen, sorted, each once. */
export function timeZoneOptions(current: string): string[] {
  return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', DEFAULT_PERSON_LOCALE.timeZone, current].map(canonicalTimeZone))].sort();
}
