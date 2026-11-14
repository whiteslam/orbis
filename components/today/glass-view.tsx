'use client';

import type { ReactNode } from 'react';
import { FocusNote } from '@/components/field/focus-note';
import { usePersonLocale } from '@/components/locale/person-locale';
import { Headsups } from '@/components/today/headsups';
import { ImportantMail } from '@/components/today/important-mail';
import { NewsCard } from '@/components/today/news-card';
import { WeatherCard } from '@/components/today/weather-card';
import type { WeatherPhase } from '@/lib/home/brief-gate';
import type { glassActivity, restOfToday } from '@/lib/home/glass';
import type { HomeNote } from '@/lib/home/note';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import type { BriefWeather } from '@/lib/home/weather';
import type { FocusTarget } from '@/lib/focus/types';
import type { HeadsupAction } from '@/lib/headsups/types';
import { formatMoney } from '@/lib/locale/money';
import { clockLabel } from '@/lib/routines/types';

const RING_RADIUS = 34;

/** One ring of the activity widget: a track and an arc for `share` (0–1). */
function Ring({ share, radius, className }: Readonly<{ share: number; radius: number; className: string }>) {
  const length = 2 * Math.PI * radius;
  return (
    <>
      <circle className="tg-ring-track" cx="44" cy="44" r={radius} />
      <circle className={className} cx="44" cy="44" r={radius} strokeDasharray={`${share * length} ${length}`} transform="rotate(-90 44 44)" />
    </>
  );
}

/**
 * Today's Glass view (spec: docs/superpowers/specs/2026-11-13-today-views-design.md):
 * the same data as Classic, as frosted widgets over the glow wallpaper. A widget
 * whose data is missing is left out, never filled in.
 */
export function GlassView({ brief, today, portfolio, activity, rest, onWeather, onPhase, openTab, openHeadsup, extras }: Readonly<{
  brief: HomeNote;
  today: string;
  portfolio: BriefPortfolio | null;
  activity: ReturnType<typeof glassActivity>;
  rest: ReturnType<typeof restOfToday>;
  onWeather: (weather: BriefWeather | null) => void;
  onPhase: (phase: WeatherPhase) => void;
  openTab: (target: FocusTarget) => void;
  openHeadsup: (action: HeadsupAction) => void;
  /** The routine check, the Gmail notice, the setup checklist and the privacy line, below the grid. */
  extras: ReactNode;
}>) {
  const loc = usePersonLocale();
  const money = (amount: number) => formatMoney(amount, loc.currency, loc.locale);
  const showPortfolio = portfolio !== null && portfolio.state === 'ok' && portfolio.total > 0;
  const day = showPortfolio ? portfolio.day : null;

  return (
    <div className="tg">
      <div className="tg-lead">
        <FocusNote note={brief} />
        <p className="tg-date" suppressHydrationWarning>{today}</p>
      </div>

      <div className="tg-grid">
        <div className="tg-area-weather">
          <WeatherCard variant="glass" onWeather={onWeather} onPhase={onPhase} openPersonal={() => openTab('personal')} />
        </div>

        {showPortfolio && (
          <button type="button" className="tg-panel tg-portfolio" onClick={() => openTab('invest')}>
            <span className="tg-label">Portfolio</span>
            <span className="tg-portfolio-total">{money(portfolio.total)}</span>
            {day && (
              <span className={`tg-portfolio-day ${day.value >= 0 ? 'is-up' : 'is-down'}`}>
                {day.value >= 0 ? '+' : '−'}{money(Math.abs(day.value))} ({Math.abs(day.percent).toFixed(1)}%) today
              </span>
            )}
            {day && day.coverage < 1 && <span className="tg-note">From the {Math.round(day.coverage * 100)}% priced live</span>}
          </button>
        )}

        <section className="tg-panel tg-activity" aria-label="Activity">
          <svg viewBox="0 0 88 88" aria-hidden="true">
            <Ring share={activity.stepShare} radius={RING_RADIUS} className="tg-ring-steps" />
            <Ring share={activity.routineShare} radius={RING_RADIUS - 11} className="tg-ring-routines" />
          </svg>
          <p className="tg-activity-steps">{activity.steps === null ? 'No steps synced today' : `${activity.steps.toLocaleString(loc.locale)} steps`}</p>
          {activity.total > 0 && <p className="tg-note">{activity.done} of {activity.total} routines</p>}
        </section>

        {rest.length > 0 && (
          <section className="tg-panel tg-rest" aria-labelledby="tg-rest-title">
            <h2 id="tg-rest-title" className="tg-label">Rest of today</h2>
            <ul>
              {rest.map((item) => <li key={item.id}><span>{clockLabel(item.time)}</span>{item.name}</li>)}
            </ul>
          </section>
        )}

        <NewsCard variant="glass" />

        {/* Heads-ups and important mail draw nothing when empty; so does this panel then (:empty). */}
        <div className="tg-panel tg-needs"><Headsups onAction={openHeadsup} /><ImportantMail /></div>
      </div>

      <div className="tg-extras">{extras}</div>
    </div>
  );
}
