'use client';

import { createContext, useContext } from 'react';
import { UserRound } from 'lucide-react';
import type { SettingsSection } from '@/lib/shell/tabs';

type SettingsAccess = { open: (section?: SettingsSection) => void; initial: string | null };

const SettingsContext = createContext<SettingsAccess | null>(null);

/** Provided by the app shell; screens reach Settings through it instead of through props. */
export const SettingsProvider = SettingsContext.Provider;

export function useSettings() {
  return useContext(SettingsContext);
}

/** The avatar in every screen's header. It opens Settings; outside the app shell it renders nothing. */
export function SettingsButton() {
  const settings = useSettings();
  if (!settings) return null;
  return (
    <button className="avatar" type="button" aria-label="Settings" title="Settings" onClick={() => settings.open()}>
      {settings.initial || <UserRound size={16} aria-hidden="true" />}
    </button>
  );
}
