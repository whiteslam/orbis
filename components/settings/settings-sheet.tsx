'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Bell, ChevronLeft, ChevronRight, Clock, Globe, LayoutGrid, Lock, Plug, Smartphone, Sparkles, UserRound, UserCog, X, type LucideIcon } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AccountData } from '@/components/settings/account-data';
import { AppIntegrations } from '@/components/settings/app-integrations';
import { HeadsupSettings } from '@/components/settings/headsup-settings';
import { HomeBriefSetting } from '@/components/settings/home-brief-setting';
import { HomeCityEditor } from '@/components/settings/integrations';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { PrivacyCenter } from '@/components/settings/privacy-center';
import { ProfileEditor, RegionSettings, TabSettings } from '@/components/settings/profile-editor';
import { RoutineSettings } from '@/components/settings/routine-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { keepTabInside } from '@/components/shell/dialog-focus';
import { useNativeApp } from '@/components/native/use-native';
import { DESKTOP_QUERY, isDesktop } from '@/lib/shell/desktop';
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

// Apple's own face wherever there is one (-apple-system in page-settings.css); Inter, the
// nearest open match to SF Pro, on Android, Windows and Linux. Self-hosted by next/font.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

/** The section a phone opens on: the list itself when Settings is opened plainly (the avatar opens 'you'). */
const pageFor = (section: SettingsSection): SettingsSection | null => (section === 'you' ? null : section);

/** True below the desktop breakpoint, where Settings is a stack of pages (the list, then one section). */
function usePhonePages() {
  const [phone, setPhone] = useState(() => !isDesktop());
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setPhone(!isDesktop());
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

// Each section's glyph in the index, drawn in the Orbis ring's colours (app/styles/page-settings.css).
const GLYPH: Record<SettingsSection, LucideIcon> = { you: UserRound, connections: Plug, ai: Sparkles, notifications: Bell, day: Clock, region: Globe, tabs: LayoutGrid, security: Lock, privacy: Smartphone, data: UserCog };

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

// `shown` marks the section picked in the list; the rest are hidden on the desktop (app/styles/desktop.css)
// and, on the phone, whenever a section is open as its own page (app/styles/page-settings.css).
function Group({ id, shown, note, children }: Readonly<{ id: SettingsSection; shown: SettingsSection; note?: string; children: ReactNode }>) {
  return (
    <section className="pf-group st-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} data-shown={shown === id || undefined} data-category={SECTION[id].category}>
      <h2 className="fd-label st-h" id={`settings-${id}-title`} tabIndex={-1}>{SECTION[id].label}</h2>
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
  const pagedRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // The section on show in the desktop list: where Settings was opened, then whatever is picked.
  const [shown, setShown] = useState(section);
  // The phone's open page: null is the list. The desktop always shows the list beside `shown`.
  const [page, setPage] = useState<SettingsSection | null>(() => pageFor(section));
  const [openedAt, setOpenedAt] = useState(section);
  if (openedAt !== section) {
    setOpenedAt(section);
    setShown(section);
    setPage(pageFor(section));
  }
  const phone = usePhonePages();
  // Phone access is the Android app's: on the web it only says to install the app, so the list leaves it out.
  const native = useNativeApp();
  const paged = phone && page !== null;

  useEffect(() => {
    if (!phone) jumpTo(section);
  }, [section, phone]);
  // A page opens at its top, and going back opens the list at its top, as pushed pages do.
  useEffect(() => {
    if (phone) dialogRef.current?.scrollTo({ top: 0 });
  }, [page, phone]);

  function openPage(id: SettingsSection, tapped: boolean) {
    setShown(id);
    setPage(id);
    if (!phone) jumpTo(id);
    requestAnimationFrame(() => {
      // On the phone the list is gone, so focus moves to the page's own title, for keyboards and screen readers.
      if (phone) document.getElementById(`settings-${id}-title`)?.focus({ preventScroll: true });
      if (tapped) pushIn(id);
    });
  }

  function back() {
    setPage(null);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }
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
    // Opened straight onto a page (the phone), the list's title isn't there: start on the page's own.
    (headingRef.current ?? document.getElementById(`settings-${section}-title`))?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
    // Once, as Settings opens: a later change of section is a page change, not a reopen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // On the phone, Escape steps back from a page to the list first, as Back does.
      if (pagedRef.current) {
        setPage(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    pagedRef.current = paged;
  }, [paged]);

  const notice = googleNotice ? GOOGLE_NOTICE[googleNotice] ?? GOOGLE_NOTICE.error : null;
  const profile = data.personalProfile.profile;
  const hints = sectionHints(data);
  const who = [profile?.preferredName.trim(), profile?.role.trim()].filter(Boolean).join(', ');

  // Every section, keyed so the sheet stacks them in the index's category order (SETTINGS_CATEGORIES).
  const groups: Record<SettingsSection, ReactNode> = {
    you: (
      <Group id="you" shown={shown}>
        <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={data.personalProfile.state} profile={profile} />
      </Group>
    ),
    security: (
      <Group id="security" shown={shown}>
        <SecuritySettings />
      </Group>
    ),
    notifications: (
      <Group id="notifications" shown={shown}>
        <NotificationSettings settings={data.notificationSettings} />
        <h3 className="fd-label st-sub">Heads-ups</h3>
        <HeadsupSettings />
      </Group>
    ),
    day: (
      <Group id="day" shown={shown}>
        <RoutineSettings summary={data.routines} editId={editRoutineId} />
      </Group>
    ),
    ai: (
      <Group id="ai" shown={shown} note="Nothing goes to an AI until this is on.">
        <HomeBriefSetting preferences={data.aiPreferences} />
      </Group>
    ),
    region: (
      <Group id="region" shown={shown}>
        <RegionSettings />
        {data.homeLocation.state !== 'setup' && <HomeCityEditor location={data.homeLocation} />}
      </Group>
    ),
    tabs: (
      <Group id="tabs" shown={shown}>
        <TabSettings />
      </Group>
    ),
    connections: (
      <Group id="connections" shown={shown} note="Read-only. Disconnect any time.">
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
      </Group>
    ),
    privacy: (
      <Group id="privacy" shown={shown} note="Nothing is read until you turn it on.">
        {privacySeen && <PrivacyCenter userId={userId} />}
      </Group>
    ),
    data: (
      <Group id="data" shown={shown}>
        <div className="st-cell st-data">
          <div className="fd-source pf-account">
            <div><strong>This device</strong><p>Your data stays in your account.</p></div>
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
      <dialog open ref={dialogRef} className={`settings-sheet field pf-screen ${inter.variable}`} aria-modal="true" aria-label="Settings" data-pages={phone || undefined} data-page={paged ? page : undefined}>
        {/* Drag down from here to close (the shared sheet motion); phone only. */}
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="settings-head">
          {paged ? (
            <button type="button" className="st-back" onClick={back}><ChevronLeft size={20} aria-hidden="true" /><span>Settings</span></button>
          ) : (
            <div className="st-title">
              <h1 ref={headingRef} tabIndex={-1}>Settings</h1>
              {who && <p className="st-who">{who}</p>}
            </div>
          )}
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
                {category.sections.filter((id) => id !== 'privacy' || native).map((id) => {
                  const Icon = GLYPH[id];
                  const hint = hints[id];
                  return (
                    <button key={id} className="st-row" data-section={id} type="button" aria-current={(!phone && shown === id) || undefined} onClick={(event) => openPage(id, event.detail > 0)}>
                      <span className="st-glyph" aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
                      <span className="st-row-label">{SECTION[id].label}</span>
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
