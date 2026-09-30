'use client';

import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { SettingsButton } from '@/components/shell/settings-context';
import { FocusNote, QuietList } from '@/components/field/field';
import { RoutineCheck } from '@/components/today/routine-check';
import { SetupChecklist } from '@/components/today/setup-checklist';
import { TodayWidgets } from '@/components/today/today-widgets';
import { WeatherCard } from '@/components/today/weather-card';
import { ImportantMail } from '@/components/today/important-mail';
import { Headsups } from '@/components/today/headsups';
import type { HealthPlanRecord } from '@/lib/health-docs/types';
import type { FinanceSummary } from '@/lib/finance/types';
import type { StepsSummary } from '@/lib/health/types';
import type { BriefWeather } from '@/lib/home/weather';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import { briefReady, type WeatherPhase } from '@/lib/home/brief-gate';
import { composeQuietRows } from '@/lib/focus/home';
import { composeSocialRow } from '@/lib/focus/social';
import type { FocusTarget } from '@/lib/focus/types';
import { indiaToday } from '@/lib/social/month';
import type { SocialPost } from '@/lib/social/types';
import { composeNote, type HomeNote } from '@/lib/home/note';
import { trainingForToday } from '@/lib/home/training';
import { currentRoutine, missedRoutines, routinesToday } from '@/lib/routines/today';
import type { RoutinesSummary } from '@/lib/routines/types';
import type { SetupStep } from '@/lib/focus/setup';
import type { HeadsupAction } from '@/lib/headsups/types';

// Home's background reads are route handlers, not server actions: actions run
// one at a time, so a slow broker or model would hold up the user's next tap.
async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

// How long Home waits for the portfolio before writing the brief without it.
const PORTFOLIO_WAIT_MS = 8_000;

// Home leads with one decision on a single lifted surface; everything else is a
// quiet row. What that decision is comes from composeFocus, not from the layout.
export function TodayScreen({ financeSummary, stepsSummary, documentCount, plan, routines, socialPosts, preferredName, aiBriefEnabled, gmailNotice, clearGmailNotice, openTab, openHeadsup, setup }: { financeSummary: FinanceSummary; stepsSummary: StepsSummary; documentCount: number; plan: HealthPlanRecord | null; routines: RoutinesSummary; socialPosts: SocialPost[]; preferredName: string | null; aiBriefEnabled: boolean; gmailNotice: string | null; clearGmailNotice: () => void; openTab: (target: FocusTarget) => void; openHeadsup: (action: HeadsupAction) => void; setup: SetupStep[] }) {
  const [weather, setWeather] = useState<BriefWeather | null>(null);
  const [weatherPhase, setWeatherPhase] = useState<WeatherPhase>('loading');
  const [written, setWritten] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<BriefPortfolio | null>(null);
  const [portfolioSettled, setPortfolioSettled] = useState(false);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  const input = { finance: financeSummary, steps: stepsSummary, documentCount, portfolio };

  // The daily investing line. Holdings come from the broker, so Home asks for
  // them the way it asks for the weather, and simply has no card until they land.
  // The brief waits for this, but never longer than PORTFOLIO_WAIT_MS: a slow
  // broker should cost the brief its investing line, not the brief itself.
  useEffect(() => {
    let live = true;
    const settle = () => { if (live) setPortfolioSettled(true); };
    const timer = setTimeout(settle, PORTFOLIO_WAIT_MS);
    void fetchJson<BriefPortfolio | null>('/api/home/portfolio', null)
      .then((result) => { if (live) setPortfolio(result); })
      .finally(() => { clearTimeout(timer); settle(); });
    return () => { live = false; clearTimeout(timer); };
  }, []);
  // Orbis's own wording renders straight away and is what stays if the model is
  // off, unreachable or slow; a written brief only ever replaces its paragraphs
  // once they land, so Home never waits on the network to say something true.
  // The schedule is read on every render rather than memoised: a routine that
  // becomes due while Home is open should start showing without a reload.
  const due = routinesToday(routines, new Date());
  const current = currentRoutine(due);
  const composed = composeNote({
    finance: financeSummary,
    portfolio,
    weather,
    training: trainingForToday(plan?.plan ?? null),
    routine: current,
    missed: missedRoutines(due),
    name: preferredName,
  });
  const brief: HomeNote = written ? { ...composed, id: 'written', caption: written } : composed;

  // Asked once the weather and the portfolio have both settled, and then again
  // only when the data behind the brief changes. The server returns the saved
  // brief unless the numbers moved, so this is one request per real change
  // rather than one per visit, or one per piece of data arriving.
  const dataKey = JSON.stringify([financeSummary.monthlyExpenses, stepsSummary.average7, documentCount, portfolio?.total, portfolio?.day?.value]);
  const ready = briefReady({ weather: weatherPhase, portfolioSettled });
  const sentKey = useRef<string | null>(null);
  useEffect(() => {
    if (!aiBriefEnabled) {
      sentKey.current = null;
      // Turning the setting off clears the cached brief immediately, rather than waiting for a refetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWritten(null);
      return;
    }
    if (!ready || sentKey.current === dataKey) return;
    // No cleanup that drops the answer: the ref already stops a second request
    // for this key (Strict Mode runs effects twice), so the first one must land.
    // An answer about data that has changed since is ignored instead.
    const key = dataKey;
    sentKey.current = key;
    void fetchJson<{ state: string; caption?: string }>(`/api/home/brief?weather=${encodeURIComponent(JSON.stringify(weather))}`, { state: 'off' })
      .then((result) => { if (sentKey.current === key && result.state === 'ok' && typeof result.caption === 'string') setWritten(result.caption); });
  }, [aiBriefEnabled, dataKey, ready, weather]);
  // The social row only appears for someone using the planner this month.
  const socialRow = composeSocialRow(socialPosts, indiaToday());
  const quiet = socialRow ? [...composeQuietRows(input), socialRow] : composeQuietRows(input);
  const heading = quiet.every((row) => row.empty) ? 'Quiet today' : 'Everything else';

  return (
    <div className="screen-body field">
      <header className="fd-top">
        {/* The date is rendered in IST on both sides, but the day can turn between them. */}
        <p className="fd-date" suppressHydrationWarning>{today}</p>
        <div className="fd-top-actions">
          <ThemeToggle />
          <SettingsButton />
        </div>
      </header>

      <PasskeyPrompt />

      <SetupChecklist steps={setup} />

      <FocusNote note={brief} />

      {/* What Orbis noticed on its own, each with its next step ready. */}
      <Headsups onAction={openHeadsup} />

      <TodayWidgets steps={stepsSummary} month={financeSummary.month} openTab={openTab} />

      {/* The brief says what is due; this records what happened to it. */}
      {/* answerRoutineAction revalidates '/', so the page re-renders with the answer on its own. */}
      {current && <RoutineCheck current={current} />}

      <WeatherCard onWeather={setWeather} onPhase={setWeatherPhase} openPersonal={() => openTab('personal')} />

      {gmailNotice && (
        <div className={`finance-notice ${gmailNotice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{gmailNotice === 'connected' ? 'Gmail connected.' : gmailNotice === 'cancelled' ? 'Gmail connection was cancelled.' : gmailNotice === 'setup-error' ? 'Gmail can’t be connected right now. Try again later.' : 'Gmail could not be connected. Try again.'}</span>
          <button type="button" onClick={clearGmailNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      <ImportantMail />

      <QuietList heading={heading} rows={quiet} onOpen={openTab} />

      <p className="fd-note">Orbis only uses what you connect or upload. Nothing above is inferred about you.</p>
    </div>
  );
}
