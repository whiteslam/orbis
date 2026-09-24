'use client';

import { useState } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { FieldLabel, QuietList } from '@/components/field/field';
import { AppIntegrations } from '@/components/personal/app-integrations';
import { ContextNotes } from '@/components/personal/context-notes';
import { FitnessPersonaEditor } from '@/components/personal/fitness-persona';
import { HomeCityEditor, Integrations } from '@/components/personal/integrations';
import { Journal } from '@/components/personal/journal';
import { NotificationSettings } from '@/components/personal/notification-settings';
import { ProfileEditor } from '@/components/personal/profile-editor';
import { composeIdentityMeta, composeProfileRows, composeProfileSummary, initialOf, type ProfileInput } from '@/lib/focus/profile';
import type { ContextNote } from '@/lib/goals/memory';
import type { StepsSummary } from '@/lib/health/types';
import type { JournalSummary } from '@/lib/journal/types';
import type { NotificationSettings as NotificationSettingsData } from '@/lib/notifications/preferences';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';

export type ProfileSection = 'journal' | 'profile' | 'settings';

// Journal first: it is the only one of the three with a reason to open today —
// an entry that closes at midnight and a streak that decays. Profile and
// Settings are configuration you touch twice. The identity block sits above the
// tabs, so the screen still reads as you whichever section is open.
const SECTIONS: Array<[ProfileSection, string]> = [
  ['journal', 'Journal'],
  ['profile', 'Profile'],
  ['settings', 'Settings'],
];

const GOOGLE_NOTICE: Record<string, { text: string; success: boolean }> = {
  connected: { text: 'Google connected.', success: true },
  cancelled: { text: 'Google connection was cancelled.', success: false },
  'setup-error': { text: 'Google sign-in isn’t set up on the server yet.', success: false },
  error: { text: 'Google could not be connected. Try again.', success: false },
};

/**
 * A settings section in the Field language: the same tracked label the other
 * tabs use to separate sections, and the sentence that qualifies it directly
 * underneath. No icon, no head rule, no box — the ground carries the group.
 */
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="fd-group">
      <FieldLabel>{title}</FieldLabel>
      {note && <p className="fd-note fd-group-note">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Who this account belongs to. Shared chrome above the tabs, in place of the
 * generic screen head: the initial, the name, what you do, and only the chips
 * that are actually true.
 */
function Identity({ input }: { input: ProfileInput }) {
  const name = input.profile?.preferredName?.trim();
  const role = input.profile?.role?.trim();
  const chips = composeIdentityMeta(input);
  return (
    <header className="fd-id">
      <span className="fd-avatar" aria-hidden="true">{initialOf(name)}</span>
      <div className="fd-id-text">
        <h1>{name || 'Your profile'}</h1>
        <p>{role || (name ? 'No role set' : 'Not set up yet')}</p>
        {chips.length > 0 && (
          <div className="fd-id-meta">
            {chips.map((chip) => <span key={chip.key} className={chip.accent ? 'on' : undefined}>{chip.label}</span>)}
          </div>
        )}
      </div>
    </header>
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
  const profile = props.personalProfile.profile;
  const notice = props.googleNotice ? GOOGLE_NOTICE[props.googleNotice] ?? GOOGLE_NOTICE.error : null;
  // Account connections are managed above; this list shows the data services behind them.
  const dataServices = props.integrations.filter((item) => item.id !== 'groww' && item.id !== 'gmail');

  const input: ProfileInput = {
    profile,
    hasCoachingStyle: Boolean(props.fitnessPersona.persona),
    noteCount: props.contextNotes.notes.length,
    journal: props.journal,
    connections: props.appConnections,
  };

  return (
    <div className="screen-body field">
      <Identity input={input} />

      <div className="fd-tabs" role="tablist" aria-label="Profile sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === 'journal' && <Journal journal={props.journal} />}

      {section === 'profile' && <>
        <p className="fd-lead">{composeProfileSummary(input)}</p>

        <QuietList heading="What Orbis holds" rows={composeProfileRows(input)} />

        <Group title="About you" note="The name Orbis calls you, what you do, and any background that helps it read the rest.">
          <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={props.personalProfile.state} profile={profile} />
        </Group>

        <Group title="Saved notes" note="Anything you asked Orbis to remember — a constraint, a preference, something you are saving for.">
          <ContextNotes ready={props.contextNotes.ready} notes={props.contextNotes.notes} />
        </Group>

        <Group title="Coaching style" note="Optional, and only Health reads it: how you want to be coached when you ask for advice on a fitness workbook or plan.">
          <FitnessPersonaEditor key={props.fitnessPersona.persona ? 'persona-saved' : 'persona-empty'} state={props.fitnessPersona.state} persona={props.fitnessPersona.persona} />
        </Group>
      </>}

      {section === 'settings' && <>
        {notice && (
          <div className={`finance-notice ${notice.success ? 'success' : 'error'}`} role="status">
            <span>{notice.text}</span>
            <button type="button" onClick={props.clearGoogleNotice} aria-label="Dismiss message">×</button>
          </div>
        )}
        <Group title="App integrations" note="The apps Orbis reads from. Everything is read-only, and you can disconnect at any time.">
          <AppIntegrations connections={props.appConnections} stepsSummary={props.stepsSummary} openHealth={props.openHealth} />
        </Group>
        <Group title="Notifications">
          <NotificationSettings settings={props.notificationSettings} />
        </Group>
        <Group title="Location">
          <HomeCityEditor location={props.homeLocation} />
        </Group>
        <Group title="Data services" note="Services Orbis uses for weather, rates, prices and AI.">
          <Integrations items={dataServices} heading={false} />
        </Group>
        <Group title="Account">
          <div className="fd-source">
            <div><strong>This device</strong><p>Sign out of Orbis here. Your data stays in your account.</p></div>
            <SignOutButton />
          </div>
        </Group>
      </>}
    </div>
  );
}
