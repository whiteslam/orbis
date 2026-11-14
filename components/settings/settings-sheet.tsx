'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ChevronRight, Clock, Eye, HardDrive, Lock, Plug, Sparkles, UserRound, X, type LucideIcon } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AccountData } from '@/components/settings/account-data';
import { AppIntegrations } from '@/components/settings/app-integrations';
import { HeadsupSettings } from '@/components/settings/headsup-settings';
import { HomeBriefSetting } from '@/components/settings/home-brief-setting';
import { HomeCityEditor, Integrations } from '@/components/settings/integrations';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { PrivacyCenter } from '@/components/settings/privacy-center';
import { ProfileEditor } from '@/components/settings/profile-editor';
import { RoutineSettings } from '@/components/settings/routine-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { keepTabInside } from '@/components/shell/dialog-focus';
import { isDesktop } from '@/lib/shell/desktop';
import { aiAllowed } from '@/lib/ai/consent';
import { SETTINGS_CATEGORIES, SETTINGS_SECTIONS, type SettingsSection } from '@/lib/shell/tabs';
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

const SECTION = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section])) as Record<SettingsSection, (typeof SETTINGS_SECTIONS)[number]>;
const CATEGORY_LABEL = Object.fromEntries(SETTINGS_CATEGORIES.map((category) => [category.id, category.label]));

// Each section's glyph in the index; its colour comes from app/styles/page-settings.css.
const GLYPH: Record<SettingsSection, LucideIcon> = { you: UserRound, connections: Plug, ai: Sparkles, notifications: Bell, day: Clock, security: Lock, privacy: Eye, data: HardDrive };

type Hint = { text: string; warn?: boolean };
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where each section stands, in a word or two, beside its row in the index. Read from the same data the sections show. */
function sectionHints(data: SettingsData): Partial<Record<SettingsSection, Hint>> {
  const { appConnections: apps, socialConnections: social } = data;
  const brokers = Object.values(apps.brokers).filter((item) => item !== undefined);
  const linked = (apps.google ? 1 : 0) + brokers.length + social.items.length + (data.stepsSummary.lastImport ? 1 : 0);
  const reconnect = (apps.google?.status === 'reconnect_required' ? 1 : 0)
    + brokers.filter((item) => item.status === 'reconnect_required').length
    + social.items.filter((item) => item.status === 'reconnect_required').length;
  const name = data.personalProfile.profile?.preferredName.trim();
  const routines = data.routines.routines.filter((routine) => routine.active).length;
  let connections: Hint = { text: linked ? `${linked} connected` : 'None yet' };
  if (reconnect) connections = { text: `${reconnect} to reconnect`, warn: true };
  return {
    you: { text: name || 'Add your name' },
    connections,
    ai: data.aiPreferences.state === 'ready' ? { text: aiAllowed(data.aiPreferences) ? 'On' : 'Off' } : undefined,
    notifications: data.notificationSettings.state === 'ready' ? { text: data.notificationSettings.preferences.enabled ? 'On' : 'Off' } : undefined,
    day: data.routines.state === 'ready' ? { text: routines ? count(routines, 'routine') : 'None yet' } : undefined,
  };
}

function jumpTo(section: SettingsSection) {
  document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
}

/** Seconds or milliseconds from a CSS time ("0.4s", "400ms"), or the fallback. */
function cssTime(value: string, fallback: number) {
  const ms = value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

/**
 * The picked section arrives from the right, as a pushed page does in iOS
 * Settings. Only for a tap or click: a key press moves instantly, and Reduce
 * Motion gets a short fade instead. The spring comes from brand.css.
 */
function pushIn(section: SettingsSection) {
  const target = document.getElementById(`settings-${section}`);
  if (!target || typeof target.animate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
    return;
  }
  const style = getComputedStyle(target);
  const easing = style.getPropertyValue('--spring').trim() || 'cubic-bezier(0.32, 0.72, 0, 1)';
  const duration = cssTime(style.getPropertyValue('--spring-dur').trim(), 450);
  target.animate([{ opacity: 0.4, transform: 'translateX(28%)' }, { opacity: 1, transform: 'none' }], { duration, easing });
}

// `shown` marks the section picked in the list; only the desktop layout hides the rest (app/styles/desktop.css).
// The line above the title names the section's category, as the index groups it.
function Group({ id, shown, note, children }: Readonly<{ id: SettingsSection; shown: SettingsSection; note?: string; children: ReactNode }>) {
  return (
    <section className="pf-group st-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} data-shown={shown === id || undefined} data-category={SECTION[id].category}>
      <p className="st-eyebrow">{CATEGORY_LABEL[SECTION[id].category]}</p>
      <h2 className="fd-label st-h" id={`settings-${id}-title`}>{SECTION[id].label}</h2>
      {note && <p className="fd-note tight st-lede">{note}</p>}
      {children}
    </section>
  );
}

/**
 * True once a section has been on screen: picked in the list, or scrolled into view on
 * the phone, where every section is stacked in one scroll. The desktop hides every
 * section but the picked one (display: none), and a hidden section never intersects.
 * Stays true until Settings closes.
 */
function useSeen(id: SettingsSection, shown: SettingsSection) {
  const [seen, setSeen] = useState(shown === id);
  if (!seen && shown === id) setSeen(true);
  useEffect(() => {
    if (seen || typeof IntersectionObserver === 'undefined') return;
    const target = document.getElementById(`settings-${id}`);
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [id, seen]);
  return seen;
}

/**
 * Everything you configure, in one place, opened from the avatar on any tab.
 * It sits above the bottom nav, so tapping a tab is always a way out. On a
 * desktop it is a large dialog over a veil instead: the sections listed down
 * the left, the chosen one on the right, and Tab kept inside it.
 */
export function SettingsSheet({ userId, section, onClose, openHealth, googleNotice, clearGoogleNotice, data, editRoutineId = null }: Readonly<{
  /** The signed-in person; the privacy center adds this phone back to their account. */
  userId: string;
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
  // What Orbis can see reads the phone list (and, in the app, the phone itself) as it
  // mounts, so it mounts only once its section is on screen, not on every Settings open.
  const privacySeen = useSeen('privacy', shown);

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
  const hints = sectionHints(data);
  const who = [profile?.preferredName.trim(), profile?.role.trim()].filter(Boolean).join(', ');

  // Every section, keyed so the sheet stacks them in the index's category order (SETTINGS_CATEGORIES).
  const groups: Record<SettingsSection, ReactNode> = {
    you: (
      <Group id="you" shown={shown} note="The name Orbis calls you, what you do, and where you are.">
        <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={data.personalProfile.state} profile={profile} />
        {data.homeLocation.state !== 'setup' && <HomeCityEditor location={data.homeLocation} />}
      </Group>
    ),
    security: (
      <Group id="security" shown={shown} note="Lock Orbis on this device, and how it opens again.">
        <SecuritySettings />
      </Group>
    ),
    notifications: (
      <Group id="notifications" shown={shown} note="When Orbis checks in with you through the day, and on which device.">
        <NotificationSettings settings={data.notificationSettings} />
      </Group>
    ),
    day: (
      <Group id="day" shown={shown} note="The times your day already has. Today leads with whatever is due, and records what you say happened to it.">
        <RoutineSettings summary={data.routines} editId={editRoutineId} />
      </Group>
    ),
    ai: (
      <Group id="ai" shown={shown} note="One switch for every AI feature. Nothing is sent to an AI provider until it is on.">
        <HomeBriefSetting preferences={data.aiPreferences} />
        <h3 className="fd-label st-sub">Heads-ups</h3>
        <HeadsupSettings />
      </Group>
    ),
    connections: (
      <Group id="connections" shown={shown} note="Everything Orbis reads from. Every connection is read-only, and you can disconnect at any time.">
        {notice && (
          <output className={`fd-msg pf-dismiss ${notice.success ? 'ok' : 'bad'}`}>
            <span>{notice.text}</span>
            <button type="button" onClick={clearGoogleNotice} aria-label="Dismiss message"><X size={14} aria-hidden="true" /></button>
          </output>
        )}
        {/* One inset grouped cell for every app, as a row each. */}
        <div className="st-cell st-apps">
          <AppIntegrations connections={data.appConnections} stepsSummary={data.stepsSummary} openHealth={openHealth} />
          <SocialConnections connections={data.socialConnections.items} ready={data.socialConnections.ready} configured={data.socialConnections.configured} />
        </div>
        <p className="fd-note tight st-subnote">Services Orbis uses for weather, rates, prices and AI.</p>
        <Integrations items={dataServices} heading={false} />
      </Group>
    ),
    privacy: (
      <Group id="privacy" shown={shown} note="What Orbis reads on your phone, and what it keeps. Nothing is read until you turn it on.">
        {privacySeen && <PrivacyCenter userId={userId} />}
      </Group>
    ),
    data: (
      <Group id="data" shown={shown} note="Sign out here, download a copy of everything, or delete it for good.">
        <div className="st-cell st-data">
          <div className="fd-source pf-account">
            <div><strong>This device</strong><p>Sign out of Orbis here. Your data stays in your account.</p></div>
            <SignOutButton variant="text" />
          </div>
          <AccountData />
        </div>
      </Group>
    ),
  };

  return (
    <>
      {/* The desktop's veil behind the dialog; a press on it closes Settings. Hidden on the phone. */}
      <div className="settings-veil" aria-hidden="true" onClick={onClose} />
      <dialog open ref={dialogRef} className="settings-sheet field pf-screen" aria-modal="true" aria-label="Settings">
        {/* Drag down from here to close (the shared sheet motion); phone only. */}
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="settings-head">
          <div className="st-title">
            <h1 ref={headingRef} tabIndex={-1}>Settings</h1>
            {who && <p className="st-who">{who}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings"><X size={18} aria-hidden="true" /></button>
        </header>
        {/* Not a <nav>: the bottom nav must stay the only navigation landmark. */}
        {/* The index: every section as a row, with what it holds and where it stands, under its category's
            heading (Your account, Preferences, …), as Instagram's and YouTube's settings group theirs.
            On a desktop it is the list down the left. */}
        <fieldset className="settings-jump st-index" aria-label="Settings sections">
          {SETTINGS_CATEGORIES.map((category) => (
            <div key={category.id} className="st-cat" role="group" aria-labelledby={`settings-cat-${category.id}`}>
              <h2 className="st-cat-h" id={`settings-cat-${category.id}`}>{category.label}</h2>
              <div className="st-cat-list">
                {category.sections.map((id) => {
                  const Icon = GLYPH[id];
                  const hint = hints[id];
                  return (
                    <button key={id} className="st-row" data-section={id} type="button" aria-current={shown === id || undefined} onClick={(event) => { setShown(id); jumpTo(id); if (event.detail > 0) pushIn(id); }}>
                      <span className="st-glyph" aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
                      <span className="st-row-text">
                        <span className="st-row-label">{SECTION[id].label}</span>
                        <span className="st-row-desc">{SECTION[id].description}</span>
                      </span>
                      {hint && <small className={hint.warn ? 'st-row-hint warn' : 'st-row-hint'}>{hint.text}</small>}
                      <ChevronRight className="st-chev" size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </fieldset>

        {SETTINGS_SECTIONS.map((item) => <Fragment key={item.id}>{groups[item.id]}</Fragment>)}
      </dialog>
    </>
  );
}
