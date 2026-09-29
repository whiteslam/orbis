'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { HeartPulse, Home, Megaphone, TrendingUp, UserRound, WalletCards } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { TabLoading } from '@/components/shell/loading';
import { SettingsProvider } from '@/components/shell/settings-context';
import { TodayScreen } from '@/components/today/today-screen';
import { aiAllowed } from '@/lib/ai/consent';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';
import type { FinanceSummary } from '@/lib/finance/types';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { StepsSummary } from '@/lib/health/types';
import type { JournalSummary } from '@/lib/journal/types';
import type { ContextNote } from '@/lib/memory/notes';
import type { NotificationSettings } from '@/lib/notifications/preferences';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';
import type { RoutinesSummary } from '@/lib/routines/types';
import type { SocialMonth } from '@/lib/social/repository';
import type { ProfileSection } from '@/components/personal/profile-screen';
import type { SettingsSection } from '@/lib/shell/tabs';

// Today is what opens, so it is the only screen in the first download. Every
// other tab loads the first time it is opened.
const SpendingScreen = dynamic(() => import('@/components/money/spending-screen').then((m) => m.SpendingScreen), { loading: TabLoading });
const InvestmentsScreen = dynamic(() => import('@/components/money/investments-screen').then((m) => m.InvestmentsScreen), { loading: TabLoading });
const HealthScreen = dynamic(() => import('@/components/health/health-screen').then((m) => m.HealthScreen), { loading: TabLoading });
const SocialScreen = dynamic(() => import('@/components/social/social-screen').then((m) => m.SocialScreen), { loading: TabLoading });
const ProfileScreen = dynamic(() => import('@/components/personal/profile-screen').then((m) => m.ProfileScreen), { loading: TabLoading });
// The mic shows on every screen but is not needed to draw Today, so it follows it.
const TalkToOrbis = dynamic(() => import('@/components/assistant/talk-to-orbis').then((m) => m.TalkToOrbis));
const SettingsSheet = dynamic(() => import('@/components/settings/settings-sheet').then((m) => m.SettingsSheet));

// Coming back to Home re-reads it only after this long away.
const STALE_AFTER_HIDDEN_MS = 60_000;

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment' | 'social';

const TAB_TO_HASH: Record<Tab, string> = { home: 'home', finance: 'finance', health: 'health', investment: 'invest', social: 'social', personal: 'profile' };
const HASH_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_HASH).map(([tab, hash]) => [hash, tab as Tab])) as Record<string, Tab>;

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Expense', WalletCards],
  ['health', 'Health', HeartPulse],
  ['investment', 'Invest', TrendingUp],
  ['social', 'Social', Megaphone],
  ['personal', 'Profile', UserRound],
] as const;

export default function AppShell({ financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth }: { financeSummary: FinanceSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null; aiPreferences: AiPreferences; routines: RoutinesSummary; socialMonth: SocialMonth & { period: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('home');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  const [zerodhaNotice, setZerodhaNotice] = useState<string | null>(null);
  // Journal is the only section with a reason to open today, so it is the landing
  // one. Deep links (Home's "open settings", the Google callback) still say where to go.
  const [profileSection, setProfileSection] = useState<ProfileSection>('journal');
  // Which Settings section is open, or null. Task 6 renders the sheet.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const settingsAccess = useMemo(() => ({
    open: (section: SettingsSection = 'you') => setSettings(section),
    initial: personalProfile.profile?.preferredName?.trim().charAt(0).toLocaleUpperCase() || null,
  }), [personalProfile.profile?.preferredName]);

  // The brief is only true for as long as its data is. Opening the app already
  // rendered it fresh, and every save revalidates the page, so Home re-reads
  // from the server only after a real absence: the app in the background for a
  // minute or more, where a task done elsewhere could otherwise linger.
  useEffect(() => {
    if (tab !== 'home') return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS) router.refresh();
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [router, tab]);

  // The tab the URL asked for, until it has been applied (see the hash effect below).
  const pendingTab = useRef<Tab | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    const notice = url.searchParams.get('gmail');
    const brokerNotice = url.searchParams.get('zerodha');
    // Reload keeps the current tab (#finance, #invest…); ?tab= links from OAuth take priority (?tab=home stays on Home).
    // A tab may carry its own state after a slash (#social/2026-09); only the part before it names the tab.
    const fromHash = HASH_TO_TAB[url.hash.slice(1).split('/')[0]];
    const opening = requestedTab === 'finance' ? 'finance' : requestedTab === 'invest' ? 'investment' : requestedTab === 'settings' ? 'personal' : !requestedTab && fromHash ? fromHash : null;
    // One-time read of the URL a link arrived with, not a value the render depends on.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requestedTab === 'settings') setProfileSection('settings');
    if (opening && opening !== 'home') {
      pendingTab.current = opening;
      setTab(opening);
    }
    if (notice) setGmailNotice(notice);
    if (brokerNotice) setZerodhaNotice(brokerNotice);
    if (requestedTab || notice || brokerNotice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      url.searchParams.delete('zerodha');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    // Until the tab read from the URL is applied, this still sees 'home'; writing
    // now would erase the hash (and a tab's own state after it, like #social/2026-11).
    if (pendingTab.current) {
      if (tab !== pendingTab.current) return;
      pendingTab.current = null;
    }
    const hash = tab === 'home' ? '' : `#${TAB_TO_HASH[tab]}`;
    // Leave a tab's own state (#social/2026-09) alone while that tab is open.
    if (hash && window.location.hash.startsWith(`${hash}/`)) return;
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [tab]);

  const screen = useMemo(() => {
    if (tab === 'home') return (
      <TodayScreen
        financeSummary={financeSummary}
        stepsSummary={stepsSummary}
        documentCount={healthLibrary.documents.length}
        plan={healthLibrary.plans[0] ?? null}
        routines={routines}
        socialPosts={socialMonth.posts}
        preferredName={personalProfile.profile?.preferredName ?? null}
        aiBriefEnabled={aiPreferences.homeBriefEnabled && aiAllowed(aiPreferences)}
        gmailNotice={gmailNotice}
        clearGmailNotice={() => setGmailNotice(null)}
        openTab={(target) => { if (target === 'personal') setProfileSection('profile'); setTab(target === 'invest' ? 'investment' : target); }}
      />
    );
    if (tab === 'social') return <SocialScreen initial={socialMonth} hasProfile={Boolean(personalProfile.profile)} />;
    if (tab === 'finance') return <SpendingScreen summary={financeSummary} />;
    if (tab === 'health') return <HealthScreen stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
    if (tab === 'personal') {
      return (
        <ProfileScreen
          key={profileSection}
          initialSection={profileSection}
          googleNotice={profileSection === 'settings' ? gmailNotice : null}
          clearGoogleNotice={() => setGmailNotice(null)}
          openHealth={() => setTab('health')}
          personalProfile={personalProfile}
          fitnessPersona={fitnessPersona}
          contextNotes={contextNotes}
          journal={journal}
          notificationSettings={notificationSettings}
          aiPreferences={aiPreferences}
          routines={routines}
          appConnections={appConnections}
          homeLocation={homeLocation}
          integrations={integrations}
          stepsSummary={stepsSummary}
        />
      );
    }
    return <InvestmentsScreen savedAdvice={savedPortfolioAdvice} notice={zerodhaNotice} clearNotice={() => setZerodhaNotice(null)} />;
  }, [appConnections, healthLibrary, contextNotes, financeSummary, fitnessPersona, gmailNotice, homeLocation, integrations, journal, notificationSettings, profileSection, personalProfile, savedPortfolioAdvice, savedWorkbookAdvice, stepsSummary, tab, aiPreferences, routines, socialMonth, zerodhaNotice]);

  return (
    <main className="stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="intro">
        <OrbisMark />
        <div><h1>Orbis</h1><p>Your personal intelligence system</p></div>
      </section>
      <div className="phone">
        <div className="phone-speaker" />
        <div className="phone-screen">
          <SettingsProvider value={settingsAccess}>
            {screen}
            {settings && (
              <SettingsSheet
                section={settings}
                onClose={() => setSettings(null)}
                openHealth={() => { setSettings(null); setTab('health'); }}
                googleNotice={gmailNotice}
                clearGoogleNotice={() => setGmailNotice(null)}
                data={{ personalProfile, notificationSettings, aiPreferences, routines, appConnections, homeLocation, integrations, stepsSummary }}
              />
            )}
            <TalkToOrbis />
            <nav className="bottom-nav">
              {nav.map(([id, label, Icon]) => (
                <button key={id} onClick={() => { setTab(id); setSettings(null); }} className={tab === id ? 'active' : ''} aria-label={label}>
                  <Icon size={17}/><span>{label}</span>
                </button>
              ))}
            </nav>
          </SettingsProvider>
        </div>
      </div>
    </main>
  );
}
