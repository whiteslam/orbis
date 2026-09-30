'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { BookOpen, HeartPulse, Home, Megaphone, WalletCards, type LucideIcon } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { TabLoading } from '@/components/shell/loading';
import { SettingsProvider } from '@/components/shell/settings-context';
import { Wallpaper } from '@/components/shell/wallpaper';
import { TodayScreen } from '@/components/today/today-screen';
import { aiAllowed } from '@/lib/ai/consent';
import { setupSteps } from '@/lib/focus/setup';
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
import { hashFor, openingFromUrl, TABS, type MoneyView, type SettingsSection, type TabId } from '@/lib/shell/tabs';
import type { FocusTarget } from '@/lib/focus/types';

// Today is what opens, so it is the only screen in the first download. Every
// other tab loads the first time it is opened.
const MoneyScreen = dynamic(() => import('@/components/money/money-screen').then((m) => m.MoneyScreen), { loading: TabLoading });
const HealthScreen = dynamic(() => import('@/components/health/health-screen').then((m) => m.HealthScreen), { loading: TabLoading });
const JournalScreen = dynamic(() => import('@/components/journal/journal-screen').then((m) => m.JournalScreen), { loading: TabLoading });
const SocialScreen = dynamic(() => import('@/components/social/social-screen').then((m) => m.SocialScreen), { loading: TabLoading });
// The mic shows on every screen but is not needed to draw Today, so it follows it.
const TalkToOrbis = dynamic(() => import('@/components/assistant/talk-to-orbis').then((m) => m.TalkToOrbis));
const SettingsSheet = dynamic(() => import('@/components/settings/settings-sheet').then((m) => m.SettingsSheet));

// Coming back to Home re-reads it only after this long away.
const STALE_AFTER_HIDDEN_MS = 60_000;

const ICONS: Record<TabId, LucideIcon> = { today: Home, money: WalletCards, health: HeartPulse, journal: BookOpen, social: Megaphone };

export default function AppShell({ financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth }: { financeSummary: FinanceSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null; aiPreferences: AiPreferences; routines: RoutinesSummary; socialMonth: SocialMonth & { period: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('today');
  const [money, setMoney] = useState<MoneyView>('spending');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  const [zerodhaNotice, setZerodhaNotice] = useState<string | null>(null);
  // Which Settings section is open, or null. Task 6 renders the sheet.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const settingsAccess = useMemo(() => ({
    open: (section: SettingsSection = 'you') => setSettings(section),
    initial: personalProfile.profile?.preferredName?.trim().charAt(0).toLocaleUpperCase() || null,
  }), [personalProfile.profile?.preferredName]);

  // Today's cards and quiet rows name where they lead in the older vocabulary.
  const openTarget = (target: FocusTarget) => {
    setSettings(null);
    if (target === 'personal') return setSettings('you');
    if (target === 'finance' || target === 'invest') {
      setMoney(target === 'invest' ? 'investments' : 'spending');
      return setTab('money');
    }
    setTab(target);
  };

  // The brief is only true for as long as its data is. Opening the app already
  // rendered it fresh, and every save revalidates the page, so Home re-reads
  // from the server only after a real absence: the app in the background for a
  // minute or more, where a task done elsewhere could otherwise linger.
  useEffect(() => {
    if (tab !== 'today') return;
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
  const pendingTab = useRef<TabId | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const opening = openingFromUrl(url.hash, url.searchParams.get('tab'));
    const notice = url.searchParams.get('gmail');
    const brokerNotice = url.searchParams.get('zerodha');
    // One-time read of the URL a link arrived with, not a value the render depends on.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (opening?.money) setMoney(opening.money);
    if (opening?.settings) setSettings(opening.settings);
    if (opening && opening.tab !== 'today') {
      pendingTab.current = opening.tab;
      setTab(opening.tab);
    }
    if (notice) setGmailNotice(notice);
    if (brokerNotice) setZerodhaNotice(brokerNotice);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (url.searchParams.has('tab') || notice || brokerNotice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      url.searchParams.delete('zerodha');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  // A hash-only link (openApp('#invest'), a bookmark, a PWA shortcut, or the hash
  // being cleared) changes the URL without a reload, so it is not seen by the mount
  // effect above; this applies it instead. Every hash this app itself writes goes
  // through replaceState, so there is no history entry of ours for back/forward to
  // land on — but an external link, a shortcut, or a hand-edited URL still fires
  // this. Unlike the one-time read, this always sets the tab (even back to Today)
  // and clears Settings when the new hash doesn't ask for it, because — running
  // after the app already booted — there is no "still today" default left to lean
  // on; an empty hash is treated the same way, as a request for Today.
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      const opening = hash ? openingFromUrl(hash, null) : { tab: 'today' as const };
      if (!opening) return;
      if (opening.money) setMoney(opening.money);
      setSettings(opening.settings ?? null);
      setTab(opening.tab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    // Until the tab read from the URL is applied, this still sees 'today'; writing
    // now would erase the hash (and Social's own month after it, #social/2026-11).
    if (pendingTab.current) {
      if (tab !== pendingTab.current) return;
      pendingTab.current = null;
    }
    // Social keeps its month in the hash itself; leave that alone while it is open.
    if (tab === 'social' && window.location.hash.startsWith('#social/')) return;
    const hash = hashFor(tab, money);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [tab, money]);

  const screen = useMemo(() => {
    if (tab === 'today') return (
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
        openTab={openTarget}
        openHeadsup={() => {}}
        setup={setupSteps({
          aiOn: aiAllowed(aiPreferences),
          googleConnected: Boolean(appConnections.google) && appConnections.google?.status !== 'reconnect_required',
          routineCount: routines.routines.length,
          hasName: Boolean(personalProfile.profile?.preferredName?.trim()),
        })}
      />
    );
    if (tab === 'money') return <MoneyScreen view={money} onView={setMoney} summary={financeSummary} savedPortfolioAdvice={savedPortfolioAdvice} brokerNotice={zerodhaNotice} clearBrokerNotice={() => setZerodhaNotice(null)} />;
    if (tab === 'health') return <HealthScreen stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} fitnessPersona={fitnessPersona} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
    if (tab === 'journal') return <JournalScreen journal={journal} contextNotes={contextNotes} />;
    return <SocialScreen initial={socialMonth} hasProfile={Boolean(personalProfile.profile)} />;
    // openTarget only calls state setters, which are stable, so it needs no entry below.
  }, [tab, money, financeSummary, stepsSummary, healthLibrary, routines, socialMonth, personalProfile, aiPreferences, appConnections, gmailNotice, savedPortfolioAdvice, zerodhaNotice, contextNotes, fitnessPersona, savedWorkbookAdvice, journal]);

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
          <Wallpaper />
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
              {TABS.map(({ id, label }) => {
                const Icon = ICONS[id];
                return (
                  <button key={id} onClick={() => { setTab(id); setSettings(null); }} className={tab === id ? 'active' : ''} aria-label={label}>
                    <Icon size={17} /><span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </SettingsProvider>
        </div>
      </div>
    </main>
  );
}
