'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AccountData } from '@/components/settings/account-data';
import { AppIntegrations } from '@/components/settings/app-integrations';
import { HeadsupSettings } from '@/components/settings/headsup-settings';
import { HomeBriefSetting } from '@/components/settings/home-brief-setting';
import { HomeCityEditor, Integrations } from '@/components/settings/integrations';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { ProfileEditor } from '@/components/settings/profile-editor';
import { RoutineSettings } from '@/components/settings/routine-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { keepTabInside } from '@/components/shell/dialog-focus';
import { isDesktop } from '@/lib/shell/desktop';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/shell/tabs';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { StepsSummary } from '@/lib/health/types';
import type { NotificationSettings as NotificationSettingsData } from '@/lib/notifications/preferences';
import type { HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';
import { SocialConnections } from '@/components/settings/social-connections';
import type { SocialConnectionStatus } from '@/lib/social/connections';
import type { RoutinesSummary } from '@/lib/routines/types';

export const GOOGLE_NOTICE: Record<string, { text: string; success: boolean }> = {
  connected: { text: 'Google connected.', success: true },
  cancelled: { text: 'Google connection was cancelled.', success: false },
  'setup-error': { text: 'Google sign-in isn’t set up on the server yet.', success: false },
  expired: { text: 'That Google sign-in took too long or started on a different address. Connect again from here.', success: false },
  error: { text: 'Google could not be connected. Try again.', success: false },
};

export type SettingsData = {
  personalProfile: PersonalProfileSummary;
  notificationSettings: NotificationSettingsData;
  aiPreferences: AiPreferences;
  routines: RoutinesSummary;
  appConnections: AppConnections;
  socialConnections: { ready: boolean; items: SocialConnectionStatus[]; configured: Record<string, boolean> };
  homeLocation: HomeLocation;
  integrations: Integration[];
  stepsSummary: StepsSummary;
};

const LABEL = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section.label])) as Record<SettingsSection, string>;

function jumpTo(section: SettingsSection) {
  document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
}

// `shown` marks the section picked in the list; only the desktop layout hides the rest (app/styles/desktop.css).
function Group({ id, shown, note, children }: Readonly<{ id: SettingsSection; shown: SettingsSection; note?: string; children: ReactNode }>) {
  return (
    <section className="pf-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} data-shown={shown === id || undefined}>
      <h2 className="fd-label" id={`settings-${id}-title`}>{LABEL[id]}</h2>
      {note && <p className="fd-note tight">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Everything you configure, in one place, opened from the avatar on any tab.
 * It sits above the bottom nav, so tapping a tab is always a way out. On a
 * desktop it is a large dialog over a veil instead: the sections listed down
 * the left, the chosen one on the right, and Tab kept inside it.
 */
export function SettingsSheet({ section, onClose, openHealth, googleNotice, clearGoogleNotice, data, editRoutineId = null }: Readonly<{
  /** A routine to open for editing, when a heads-up asked to adjust it. */
  editRoutineId?: string | null;
  section: SettingsSection;
  onClose: () => void;
  openHealth: () => void;
  googleNotice: string | null;
  clearGoogleNotice: () => void;
  data: SettingsData;
}>) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // The section on show in the desktop list: where Settings was opened, then whatever is picked.
  const [shown, setShown] = useState(section);
  const [openedAt, setOpenedAt] = useState(section);
  if (openedAt !== section) {
    setOpenedAt(section);
    setShown(section);
  }

  useEffect(() => jumpTo(section), [section]);

  // Move focus into the sheet on open, and give it back to whatever opened it
  // (an avatar button, a Today card) on close — a mount/unmount effect, since
  // the sheet only ever unmounts when Settings actually closes, not when the
  // section it jumps to changes. preventScroll matters here: an unqualified
  // focus() scrolls its target into view, which would fight the jumpTo(section)
  // effect above and drag the sheet back to the top instead of the section a
  // caller (like Today's setup checklist) asked to open.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // On a desktop the sheet is a modal dialog over the page, so Tab stays in
      // it (Ask Orbis, docked beside it, keeps its own). The phone's sheet
      // leaves the tab bar reachable, as it always has.
      const dialog = dialogRef.current;
      if (event.key === 'Tab' && dialog && isDesktop()) {
        const at = document.activeElement;
        if (at instanceof Node && document.querySelector('.talk-sheet')?.contains(at)) return;
        if (!(at instanceof Node) || !dialog.contains(at)) {
          event.preventDefault();
          headingRef.current?.focus({ preventScroll: true });
          return;
        }
        keepTabInside(dialog, event);
        return;
      }
      if (event.key !== 'Escape') return;
      // Ask Orbis can be open over Settings; it owns Escape while it is, so a
      // question in progress there isn't lost to Settings closing underneath it.
      if (document.querySelector('.talk-sheet')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notice = googleNotice ? GOOGLE_NOTICE[googleNotice] ?? GOOGLE_NOTICE.error : null;
  const profile = data.personalProfile.profile;
  // Gmail and Groww are already in the list above as account connections.
  const dataServices = data.integrations.filter((item) => item.id !== 'groww' && item.id !== 'gmail');

  return (
    <>
      {/* The desktop's veil behind the dialog; a press on it closes Settings. Hidden on the phone. */}
      <div className="settings-veil" aria-hidden="true" onClick={onClose} />
      <dialog open ref={dialogRef} className="settings-sheet field pf-screen" aria-modal="true" aria-label="Settings">
        <header className="settings-head">
          <h1 ref={headingRef} tabIndex={-1}>Settings</h1>
          <button type="button" onClick={onClose} aria-label="Close settings"><X size={18} aria-hidden="true" /></button>
        </header>
        {/* Not a <nav>: the bottom nav must stay the only navigation landmark. */}
        <fieldset className="settings-jump" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => (
            <button key={item.id} type="button" aria-current={shown === item.id || undefined} onClick={() => { setShown(item.id); jumpTo(item.id); }}>{item.label}</button>
          ))}
        </fieldset>

        <Group id="you" shown={shown} note="The name Orbis calls you, what you do, and where you are.">
          <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={data.personalProfile.state} profile={profile} />
          {data.homeLocation.state !== 'setup' && <HomeCityEditor location={data.homeLocation} />}
        </Group>

        <Group id="connections" shown={shown} note="Everything Orbis reads from. Every connection is read-only, and you can disconnect at any time.">
          {notice && (
            <output className={`fd-msg pf-dismiss ${notice.success ? 'ok' : 'bad'}`}>
              <span>{notice.text}</span>
              <button type="button" onClick={clearGoogleNotice} aria-label="Dismiss message"><X size={14} aria-hidden="true" /></button>
            </output>
          )}
          <AppIntegrations connections={data.appConnections} stepsSummary={data.stepsSummary} openHealth={openHealth} />
          <SocialConnections connections={data.socialConnections.items} ready={data.socialConnections.ready} configured={data.socialConnections.configured} />
          <p className="fd-note tight">Services Orbis uses for weather, rates, prices and AI.</p>
          <Integrations items={dataServices} heading={false} />
        </Group>

        <Group id="ai" shown={shown} note="One switch for every AI feature. Nothing is sent to an AI provider until it is on.">
          <HomeBriefSetting preferences={data.aiPreferences} />
          <h3 className="fd-label">Heads-ups</h3>
          <HeadsupSettings />
        </Group>

        <Group id="notifications" shown={shown}>
          <NotificationSettings settings={data.notificationSettings} />
        </Group>

        <Group id="day" shown={shown} note="The times your day already has. Today leads with whatever is due, and records what you say happened to it.">
          <RoutineSettings summary={data.routines} editId={editRoutineId} />
        </Group>

        <Group id="security" shown={shown}>
          <SecuritySettings />
        </Group>

        <Group id="data" shown={shown}>
          <div className="fd-source pf-account">
            <div><strong>This device</strong><p>Sign out of Orbis here. Your data stays in your account.</p></div>
            <SignOutButton variant="text" />
          </div>
          <AccountData />
        </Group>
      </dialog>
    </>
  );
}
