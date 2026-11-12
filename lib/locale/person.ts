// A person's own time zone, currency, language and chosen modules.
// Pure and client-safe: no server imports, so client components can use it too.

export type PersonLocale = { timeZone: string; currency: string; locale: string };

/** What anyone without a settings row gets. India first, exactly as before accounts could differ. */
export const DEFAULT_PERSON_LOCALE: PersonLocale = { timeZone: 'Asia/Kolkata', currency: 'INR', locale: 'en-IN' };

/** One per tab in lib/shell/tabs.ts. */
export type ModuleId = 'money' | 'health' | 'journal' | 'social' | 'career';
export const ALL_MODULES: ModuleId[] = ['money', 'health', 'journal', 'social', 'career'];

export type PersonSettings = PersonLocale & { modules: ModuleId[]; onboardedAt: string | null };

export function isValidTimeZone(value: string): boolean {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ICU (Chrome, Node) still lists and resolves some zones by their old names.
// Orbis stores and offers the current IANA name, so a stored zone always
// matches one in the picker and the same place never appears twice.
// A Map, so an untrusted string can't reach Object.prototype through the lookup.
const ZONE_RENAMES: Map<string, string> = new Map([
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['Asia/Katmandu', 'Asia/Kathmandu'],
  ['Asia/Rangoon', 'Asia/Yangon'],
  ['Europe/Kiev', 'Europe/Kyiv'],
]);

/** The current IANA name for a zone ICU may report by an old one ('Asia/Calcutta' → 'Asia/Kolkata'); anything else unchanged. */
export function canonicalTimeZone(zone: string): string {
  return ZONE_RENAMES.get(zone) ?? zone;
}

export function isValidCurrency(value: string): boolean {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return false;
  // Intl.NumberFormat accepts any well-formed code (even 'XYZ'), so check the real list too.
  if (!Intl.supportedValuesOf('currency').includes(value)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(value: string): boolean {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (ALL_MODULES as string[]).includes(value);
}

/** Turns a user_settings row (or no row) into settings. Anything invalid or missing falls back to the defaults. */
export function normalizeSettings(row: Record<string, unknown> | null): PersonSettings {
  const timeZone = row && typeof row.timezone === 'string' && isValidTimeZone(row.timezone) ? canonicalTimeZone(row.timezone) : DEFAULT_PERSON_LOCALE.timeZone;
  const currency = row && typeof row.currency === 'string' && isValidCurrency(row.currency) ? row.currency : DEFAULT_PERSON_LOCALE.currency;
  const locale = row && typeof row.locale === 'string' && isValidLocale(row.locale) ? row.locale : DEFAULT_PERSON_LOCALE.locale;
  // A missing or malformed list means every module; a real list keeps only known ones, once each.
  const modules = row && Array.isArray(row.modules) ? [...new Set(row.modules.filter(isModuleId))] : [...ALL_MODULES];
  const onboardedAt = row && typeof row.onboarded_at === 'string' && row.onboarded_at ? row.onboarded_at : null;
  return { timeZone, currency, locale, modules, onboardedAt };
}

// Settings couldn't be read; treat the person as onboarded.
export const ONBOARDED_UNKNOWN = '1970-01-01T00:00:00.000Z';

/**
 * Turns the result of reading user_settings into settings. A failed read (or a
 * missing table) gives the defaults marked onboarded, so a blip never sends an
 * existing person back to onboarding; only a good read with no row is "not onboarded".
 */
export function settingsFromRead(data: Record<string, unknown> | null, failed: boolean): PersonSettings {
  if (failed) return { ...normalizeSettings(null), onboardedAt: ONBOARDED_UNKNOWN };
  return normalizeSettings(data);
}

/**
 * The zone to schedule a person's reminders and scans in. Their settings row
 * (user_settings) is the record. The zone saved with their notifications is
 * used only when that row couldn't be read or doesn't exist yet; then the default.
 */
export function zoneForPerson(settingsZone: string | null | undefined, notificationZone: unknown): string {
  if (typeof settingsZone === 'string' && isValidTimeZone(settingsZone)) return canonicalTimeZone(settingsZone);
  if (typeof notificationZone === 'string' && isValidTimeZone(notificationZone)) return canonicalTimeZone(notificationZone);
  return DEFAULT_PERSON_LOCALE.timeZone;
}
