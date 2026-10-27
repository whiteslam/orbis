'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { DesktopHeader } from '@/components/shell/desktop-header';
import { DesktopRail } from '@/components/shell/desktop-rail';
import { TabLoading } from '@/components/shell/loading';
import { TAB_ICONS } from '@/components/shell/tab-icons';
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
import type { SocialConnectionStatus } from '@/lib/social/connections';

type SettingsSocial = { ready: boolean; items: SocialConnectionStatus[]; configured: Record<string, boolean> };
import type { RoutinesSummary } from '@/lib/routines/types';
import type { SocialMonth } from '@/lib/social/repository';
import type { HeadsupAction } from '@/lib/headsups/types';
import { hashFor, openingFromUrl, TABS, type MoneyView, type SettingsSection, type TabId } from '@/lib/shell/tabs';
import type { FocusTarget } from '@/lib/focus/types';
import { socialConnectNotice, type SocialConnectNotice } from '@/lib/social/connect-notice';
import { openAskPanel } from '@/lib/ask/about';
import { DESKTOP_LAYOUT, isDesktop } from '@/lib/shell/desktop';
import type { PaletteGo } from '@/lib/shell/palette';

// Today is what opens, so it is the only screen in the first download. Every
// other tab loads the first time it is opened.
const MoneyScreen = dynamic(() => import('@/components/money/money-screen').then((m) => m.MoneyScreen), { loading: TabLoading });
const HealthScreen = dynamic(() => import('@/components/health/health-screen').then((m) => m.HealthScreen), { loading: TabLoading });
const JournalScreen = dynamic(() => import('@/components/journal/journal-screen').then((m) => m.JournalScreen), { loading: TabLoading });
const SocialScreen = dynamic(() => import('@/components/social/social-screen').then((m) => m.SocialScreen), { loading: TabLoading });
const CareerScreen = dynamic(() => import('@/components/career/career-screen').then((m) => m.CareerScreen), { loading: TabLoading });
// The mic shows on every screen but is not needed to draw Today, so it follows it.
const TalkToOrbis = dynamic(() => import('@/components/assistant/talk-to-orbis').then((m) => m.TalkToOrbis));
const SettingsSheet = dynamic(() => import('@/components/settings/settings-sheet').then((m) => m.SettingsSheet));
// The desktop's Ctrl/⌘+K palette knows the Career panel's pages, so it loads on first use.
const AppPalette = dynamic(() => import('@/components/shell/app-palette').then((m) => m.AppPalette));

// Coming back to Home re-reads it only after this long away.
const STALE_AFTER_HIDDEN_MS = 60_000;

export default function AppShell({ financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth, socialConnections }: Readonly<{ financeSummary: FinanceSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null; aiPreferences: AiPreferences; routines: RoutinesSummary; socialMonth: SocialMonth & { period: string }; socialConnections: SettingsSocial }>) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('today');
  const [money, setMoney] = useState<MoneyView>('spending');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  // Career's "Allow sending" returns to the Career tab with its own result; Today keeps its own notices.
  const [careerGmailNotice, setCareerGmailNotice] = useState<string | null>(null);
  const [zerodhaNotice, setZerodhaNotice] = useState<string | null>(null);
  const [socialNotice, setSocialNotice] = useState<SocialConnectNotice | null>(null);
  // Which Settings section is open, or null. Task 6 renders the sheet.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // The step a heads-up prepared. Screens read it once, as they mount from that tap.
  const [intent, setIntent] = useState<HeadsupAction | null>(null);
  // The desktop's command palette (Ctrl/⌘+K), open or not.
  const [palette, setPalette] = useState(false);
  const closePalette = useCallback(() => setPalette(false), []);
  const settingsAccess = useMemo(() => ({
    open: (section: SettingsSection = 'you') => setSettings(section),
    initial: personalProfile.profile?.preferredName?.trim().charAt(0).toLocaleUpperCase() || null,
  }), [personalProfile.profile?.preferredName]);

  // Today's cards and quiet rows name where they lead in the older vocabulary.
  const openTarget = (target: FocusTarget) => {
    setIntent(null);
    setSettings(null);
    if (target === 'personal') return setSettings('you');
    if (target === 'finance' || target === 'invest') {
      setMoney(target === 'invest' ? 'investments' : 'spending');
      return setTab('money');
    }
    setTab(target);
  };

  // A heads-up's prepared step: open the screen it belongs to, ready to go.
  const openHeadsup = (action: HeadsupAction) => {
    setIntent(action);
    if (action.type === 'adjust_routine') return setSettings('day');
    setSettings(null);
    if (action.type === 'open_spending_entry' || action.type === 'review_category') {
      setMoney('spending');
      return setTab('money');
    }
    if (action.type === 'open_career_application') return setTab('career');
    setTab('health');
  };

  // A tab chosen from the bottom nav or the desktop rail: the tab, nothing else open.
  const goTab = (id: TabId) => {
    setTab(id);
    setSettings(null);
    setIntent(null);
  };

  // A place picked in the desktop palette.
  const goPalette = (go: PaletteGo) => {
    setPalette(false);
    if (go.to === 'ask') return openAskPanel();
    if (go.to === 'href') return window.location.assign(go.href);
    if (go.to === 'settings') return setSettings(go.section);
    if (go.money) setMoney(go.money);
    goTab(go.tab);
  };

  // Ctrl/⌘+K, and "/" outside a text field, open the palette, on desktop only:
  // the phone layout keeps every key doing what it did before.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing;
      if ((!combo && !slash) || !isDesktop()) return;
      event.preventDefault();
      setPalette(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // On the phone each screen scrolls inside itself and starts at the top; on
  // desktop the window scrolls, so a new tab or Money view starts there too.
  useEffect(() => {
    if (isDesktop()) window.scrollTo({ top: 0 });
  }, [tab, money]);

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
    const socialResult = url.searchParams.get('social');
    // One-time read of the URL a link arrived with, not a value the render depends on.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (opening?.money) setMoney(opening.money);
    if (opening?.settings) setSettings(opening.settings);
    if (opening && opening.tab !== 'today') {
      pendingTab.current = opening.tab;
      setTab(opening.tab);
    }
    if (notice && opening?.tab === 'career' && !opening.settings) setCareerGmailNotice(notice);
    else if (notice) setGmailNotice(notice);
    if (brokerNotice) setZerodhaNotice(brokerNotice);
    if (socialResult) setSocialNotice(socialConnectNotice(socialResult, url.searchParams.get('why')));
    /* eslint-enable react-hooks/set-state-in-effect */
    if (url.searchParams.has('tab') || notice || brokerNotice || socialResult) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      url.searchParams.delete('zerodha');
      url.searchParams.delete('social');
      url.searchParams.delete('why');
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
        preferredName={personalProfile.profile?.preferredName ?? null}
        aiBriefEnabled={aiPreferences.homeBriefEnabled && aiAllowed(aiPreferences)}
        gmailNotice={gmailNotice}
        clearGmailNotice={() => setGmailNotice(null)}
        openTab={openTarget}
        openHeadsup={openHeadsup}
        setup={setupSteps({
          aiOn: aiAllowed(aiPreferences),
          googleConnected: Boolean(appConnections.google) && appConnections.google?.status !== 'reconnect_required',
          routineCount: routines.routines.length,
          hasName: Boolean(personalProfile.profile?.preferredName?.trim()),
        })}
      />
    );
    if (tab === 'money') return <MoneyScreen intent={intent} view={money} onView={setMoney} summary={financeSummary} savedPortfolioAdvice={savedPortfolioAdvice} brokerNotice={zerodhaNotice} clearBrokerNotice={() => setZerodhaNotice(null)} />;
    if (tab === 'health') return <HealthScreen intent={intent} stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} fitnessPersona={fitnessPersona} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
    if (tab === 'journal') return <JournalScreen journal={journal} contextNotes={contextNotes} />;
    if (tab === 'career') return <CareerScreen intent={intent} gmailNotice={careerGmailNotice} clearGmailNotice={() => setCareerGmailNotice(null)} />;
    return <SocialScreen initial={socialMonth} hasProfile={Boolean(personalProfile.profile)} connectNotice={socialNotice} clearConnectNotice={() => setSocialNotice(null)} />;
    // openTarget only calls state setters, which are stable, so it needs no entry below.
  }, [tab, money, financeSummary, stepsSummary, healthLibrary, routines, socialMonth, personalProfile, aiPreferences, appConnections, gmailNotice, careerGmailNotice, savedPortfolioAdvice, zerodhaNotice, socialNotice, contextNotes, fitnessPersona, savedWorkbookAdvice, journal, intent]);

  return (
    <main className="stage" data-tab={tab} data-money={money} data-desktop={DESKTOP_LAYOUT || undefined}>
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
            {/* Desktop only: hidden by app/styles/desktop.css below the breakpoint, and everywhere unless data-desktop is set. */}
            <DesktopRail tab={tab} onTab={goTab} onAsk={openAskPanel} onSettings={() => setSettings('you')} />
            <DesktopHeader name={personalProfile.profile?.preferredName ?? null} onSearch={() => setPalette(true)} onHeadsup={openHeadsup} />
            {screen}
            {settings && (
              <SettingsSheet
                section={settings}
                onClose={() => { setSettings(null); setIntent(null); }}
                editRoutineId={intent?.type === 'adjust_routine' ? intent.routineId : null}
                openHealth={() => { setSettings(null); setTab('health'); }}
                googleNotice={gmailNotice}
                clearGoogleNotice={() => setGmailNotice(null)}
                data={{ personalProfile, notificationSettings, aiPreferences, routines, appConnections, socialConnections, homeLocation, integrations, stepsSummary }}
              />
            )}
            <TalkToOrbis />
            <nav className="bottom-nav">
              {TABS.map(({ id, label }) => {
                const Icon = TAB_ICONS[id];
                return (
                  <button key={id} onClick={() => goTab(id)} className={tab === id ? 'active' : ''} aria-label={label}>
                    <Icon size={20} /><span>{label}</span>
                  </button>
                );
              })}
            </nav>
            {/* Its own boundary: while the palette's code loads on first use, only
                the palette waits. Without it React hides the whole app behind the
                nearest boundary up the tree, which also drops focus from whatever
                opened it, so Escape had nowhere to give it back to. */}
            {palette && <Suspense fallback={null}><AppPalette onGo={goPalette} onClose={closePalette} /></Suspense>}
          </SettingsProvider>
        </div>
      </div>
    </main>
  );
}
