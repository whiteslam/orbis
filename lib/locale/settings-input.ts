/**
 * Checks the time zone, currency, language and modules a person sends from
 * Settings or onboarding. Pure, so the server actions share one tested rule.
 */

import { isValidCurrency, isValidLocale, isValidTimeZone, type ModuleId } from '@/lib/locale/person';
import { parseModules } from '@/lib/shell/modules';

/** `locale` is left out when the form doesn't ask for it (onboarding), so a saved one is kept. */
export type SettingsInput = { timeZone: string; currency: string; locale: string | undefined; modules: ModuleId[] };

export type ParsedSettings = { ok: true; value: SettingsInput } | { ok: false; message: string };

export function parseSettingsInput(value: unknown): ParsedSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: 'These settings are invalid.' };
  const input = value as Record<string, unknown>;
  if (typeof input.timeZone !== 'string' || !isValidTimeZone(input.timeZone)) return { ok: false, message: 'Pick a valid time zone.' };
  if (typeof input.currency !== 'string' || !isValidCurrency(input.currency)) return { ok: false, message: 'Pick a valid currency.' };
  if (input.locale !== undefined && (typeof input.locale !== 'string' || !isValidLocale(input.locale))) return { ok: false, message: 'Pick a valid language.' };
  const modules = parseModules(input.modules);
  if (!modules) return { ok: false, message: 'Pick modules from the list.' };
  return { ok: true, value: { timeZone: input.timeZone, currency: input.currency, locale: input.locale, modules } };
}
