'use client';

import { useState } from 'react';
import { BellRing, BookOpen, Link2, MapPin, Settings, Server, ShieldCheck, UserRound } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AppIntegrations } from '@/components/personal/app-integrations';
import { ContextNotes } from '@/components/personal/context-notes';
import { FitnessPersonaEditor } from '@/components/personal/fitness-persona';
import { HomeCityEditor, Integrations } from '@/components/personal/integrations';
import { Journal } from '@/components/personal/journal';
import { NotificationSettings } from '@/components/personal/notification-settings';
import { ProfileEditor } from '@/components/personal/profile-editor';
import type { ContextNote } from '@/lib/goals/memory';
import type { StepsSummary } from '@/lib/health/types';
import type { JournalSummary } from '@/lib/journal/types';
import type { NotificationSettings as NotificationSettingsData } from '@/lib/notifications/preferences';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';

export type ProfileSection = 'profile' | 'journal' | 'settings';

const SECTIONS: Array<[ProfileSection, string, React.ElementType]> = [
  ['profile', 'Profile', UserRound],
  ['journal', 'Journal', BookOpen],
  ['settings', 'Settings', Settings],
];

const GOOGLE_NOTICE: Record<string, { text: string; success: boolean }> = {
  connected: { text: 'Google connected.', success: true },
  cancelled: { text: 'Google connection was cancelled.', success: false },
  'setup-error': { text: 'Google sign-in isn’t set up on the server yet.', success: false },
  error: { text: 'Google could not be connected. Try again.', success: false },
};

function SettingsGroup({ icon: Icon, title, note, children }: { icon: React.ElementType; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <div className="settings-group-head"><Icon size={15} aria-hidden="true" /><h3>{title}</h3></div>
      {note && <p className="settings-group-note">{note}</p>}
      {children}
    </section>
  );
}

export function ProfileScreen(props: {
  initialSection: ProfileSection;
  googleNotice: string | null;
  clearGoogleNotice: () => void;
  openHealth: () => void;
  personalProfile: PersonalProfileSummary;
  fitnessPersona: FitnessPersonaSummary;
  contextNotes: { ready: boolean; notes: ContextNote[] };
  journal: JournalSummary;
  notificationSettings: NotificationSettingsData;
  appConnections: AppConnections;
  homeLocation: HomeLocation;
  integrations: Integration[];
  stepsSummary: StepsSummary;
}) {
  const [section, setSection] = useState<ProfileSection>(props.initialSection);
  const name = props.personalProfile.profile?.preferredName?.trim();
  const notice = props.googleNotice ? GOOGLE_NOTICE[props.googleNotice] ?? GOOGLE_NOTICE.error : null;
  // Account connections are managed above; this list shows the data services behind them.
  const dataServices = props.integrations.filter((item) => item.id !== 'groww' && item.id !== 'gmail');

  return (
    <div className="screen-body">
      <header className="profile-head">
        <div className="profile-avatar" aria-hidden="true">{name?.charAt(0).toLocaleUpperCase() || <UserRound size={22} />}</div>
        <div>
          <small>ORBIS</small>
          <h2>{name || 'Your profile'}</h2>
          {props.personalProfile.profile?.role && <p>{props.personalProfile.profile.role}</p>}
        </div>
      </header>

      <div className="profile-tabs" role="tablist" aria-label="Profile sections">
        {SECTIONS.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
            <Icon size={14} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {section === 'profile' && <>
        <ProfileEditor key={props.personalProfile.profile?.preferredName ?? props.personalProfile.profile?.aboutMe ?? 'personal-profile-draft'} state={props.personalProfile.state} profile={props.personalProfile.profile} />
        <FitnessPersonaEditor key={props.fitnessPersona.persona ?? 'fitness-persona-draft'} state={props.fitnessPersona.state} persona={props.fitnessPersona.persona} />
        <ContextNotes ready={props.contextNotes.ready} notes={props.contextNotes.notes} />
      </>}

      {section === 'journal' && <Journal journal={props.journal} />}

      {section === 'settings' && <>
        {notice && (
          <div className={`finance-notice ${notice.success ? 'success' : 'error'}`} role="status">
            <span>{notice.text}</span>
            <button type="button" onClick={props.clearGoogleNotice} aria-label="Dismiss message">×</button>
          </div>
        )}
        <SettingsGroup icon={Link2} title="App integrations" note="Link the apps Orbis reads from. Everything is read-only, and you can disconnect at any time.">
          <AppIntegrations connections={props.appConnections} stepsSummary={props.stepsSummary} openHealth={props.openHealth} />
        </SettingsGroup>
        <SettingsGroup icon={BellRing} title="Notifications">
          <NotificationSettings settings={props.notificationSettings} />
        </SettingsGroup>
        <SettingsGroup icon={MapPin} title="Location">
          <HomeCityEditor location={props.homeLocation} />
        </SettingsGroup>
        <SettingsGroup icon={Server} title="Data services" note="Services Orbis uses for weather, rates, prices and AI.">
          <Integrations items={dataServices} heading={false} />
        </SettingsGroup>
        <SettingsGroup icon={ShieldCheck} title="Account">
          <div className="settings-account"><span>Sign out of Orbis on this device.</span><SignOutButton /></div>
        </SettingsGroup>
      </>}
    </div>
  );
}
