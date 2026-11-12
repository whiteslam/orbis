'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ALL_MODULES, DEFAULT_PERSON_LOCALE, type PersonLocale, type PersonSettings } from '@/lib/locale/person';

// What anyone outside the shell (public pages, tests) gets: India first, every module on.
const DEFAULT_SETTINGS: PersonSettings = { ...DEFAULT_PERSON_LOCALE, modules: ALL_MODULES, onboardedAt: null };

const PersonSettingsContext = createContext<PersonSettings>(DEFAULT_SETTINGS);

/** Hands the signed-in person's settings (loaded on the server) to every component below it. */
export function PersonSettingsProvider({ value, children }: { value: PersonSettings; children: ReactNode }) {
  return <PersonSettingsContext.Provider value={value}>{children}</PersonSettingsContext.Provider>;
}

/** The whole settings object: locale, chosen modules and when onboarding finished. */
export function usePersonSettings(): PersonSettings {
  return useContext(PersonSettingsContext);
}

/** Just the time zone, currency and language. The same object is returned until one of them changes. */
export function usePersonLocale(): PersonLocale {
  const { timeZone, currency, locale } = useContext(PersonSettingsContext);
  return useMemo(() => ({ timeZone, currency, locale }), [timeZone, currency, locale]);
}
