'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AccountData } from '@/components/settings/account-data';
import { AppIntegrations } from '@/components/settings/app-integrations';
import { HomeBriefSetting } from '@/components/settings/home-brief-setting';
import { HomeCityEditor, Integrations } from '@/components/settings/integrations';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { ProfileEditor } from '@/components/settings/profile-editor';
import { RoutineSettings } from '@/components/settings/routine-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/shell/tabs';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { StepsSummary } from '@/lib/health/types';
import type { NotificationSettings as NotificationSettingsData } from '@/lib/notifications/preferences';
import type { HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';
import type { RoutinesSummary } from '@/lib/routines/types';

export const GOOGLE_NOTICE: Record<string, { text: string; success: boolean }> = {
  connected: { text: 'Google connected.', success: true },
  cancelled: { text: 'Google connection was cancelled.', success: false },
  'setup-error': { text: 'Google sign-in isn’t set up on the server yet.', success: false },
  error: { text: 'Google could not be connected. Try again.', success: false },
};

export type SettingsData = {
  personalProfile: PersonalProfileSummary;
  notificationSettings: NotificationSettingsData;
  aiPreferences: AiPreferences;
  routines: RoutinesSummary;
  appConnections: AppConnections;
  homeLocation: HomeLocation;
  integrations: Integration[];
  stepsSummary: StepsSummary;
};

const LABEL = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section.label])) as Record<SettingsSection, string>;

function jumpTo(section: SettingsSection) {
  document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
}

function Group({ id, note, children }: { id: SettingsSection; note?: string; children: ReactNode }) {
  return (
    <section className="pf-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h2 className="fd-label" id={`settings-${id}-title`}>{LABEL[id]}</h2>
      {note && <p className="fd-note tight">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Everything you configure, in one place, opened from the avatar on any tab.
 * It sits above the bottom nav, so tapping a tab is always a way out.
 */
export function SettingsSheet({ section, onClose, openHealth, googleNotice, clearGoogleNotice, data }: {
  section: SettingsSection;
  onClose: () => void;
  openHealth: () => void;
  googleNotice: string | null;
  clearGoogleNotice: () => void;
  data: SettingsData;
}) {
  useEffect(() => jumpTo(section), [section]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notice = googleNotice ? GOOGLE_NOTICE[googleNotice] ?? GOOGLE_NOTICE.error : null;
  const profile = data.personalProfile.profile;
  // Gmail and Groww are already in the list above as account connections.
  const dataServices = data.integrations.filter((item) => item.id !== 'groww' && item.id !== 'gmail');

  return (
    <section className="settings-sheet field pf-screen" role="dialog" aria-label="Settings">
      <header className="settings-head">
        <h1>Settings</h1>
        <button type="button" onClick={onClose} aria-label="Close settings"><X size={18} aria-hidden="true" /></button>
      </header>
      {/* Not a <nav>: the bottom nav must stay the only navigation landmark. */}
      <div className="settings-jump" role="group" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((item) => <button key={item.id} type="button" onClick={() => jumpTo(item.id)}>{item.label}</button>)}
      </div>

      <Group id="you" note="The name Orbis calls you, what you do, and where you are.">
        <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={data.personalProfile.state} profile={profile} />
        {data.homeLocation.state !== 'setup' && <HomeCityEditor location={data.homeLocation} />}
      </Group>

      <Group id="connections" note="Everything Orbis reads from. Every connection is read-only, and you can disconnect at any time.">
        {notice && (
          <div className={`fd-msg pf-dismiss ${notice.success ? 'ok' : 'bad'}`} role="status">
            <span>{notice.text}</span>
            <button type="button" onClick={clearGoogleNotice} aria-label="Dismiss message"><X size={14} aria-hidden="true" /></button>
          </div>
        )}
        <AppIntegrations connections={data.appConnections} stepsSummary={data.stepsSummary} openHealth={openHealth} />
        <p className="fd-note tight">Services Orbis uses for weather, rates, prices and AI.</p>
        <Integrations items={dataServices} heading={false} />
      </Group>

      <Group id="ai" note="One switch for every AI feature. Nothing is sent to an AI provider until it is on.">
        <HomeBriefSetting preferences={data.aiPreferences} />
      </Group>

      <Group id="notifications">
        <NotificationSettings settings={data.notificationSettings} />
      </Group>

      <Group id="day" note="The times your day already has. Today leads with whatever is due, and records what you say happened to it.">
        <RoutineSettings summary={data.routines} />
      </Group>

      <Group id="security">
        <SecuritySettings />
      </Group>

      <Group id="data">
        <div className="fd-source pf-account">
          <div><strong>This device</strong><p>Sign out of Orbis here. Your data stays in your account.</p></div>
          <SignOutButton variant="text" />
        </div>
        <AccountData />
      </Group>
    </section>
  );
}
