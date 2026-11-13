'use client';

import { useEffect, useState, useTransition } from 'react';
import { ExternalLink, ImageOff, RefreshCw } from 'lucide-react';
import { loadSocialInsightsAction } from '@/app/social/insights-actions';
import { BrandMark } from '@/components/settings/brand-mark';
import { useSettings } from '@/components/shell/settings-context';
import { safeAction } from '@/lib/client/safe-action';
import { compactCount, thumbnailSrc, type InsightPost, type PlatformInsights } from '@/lib/social/insights-shape';
import { usePersonLocale } from '@/components/locale/person-locale';
import { formatWhen } from '@/lib/locale/dates';
import type { PersonLocale } from '@/lib/locale/person';

const NAMES = { instagram: 'Instagram', threads: 'Threads' } as const;
const when = (timestamp: string | null, loc: PersonLocale) => {
  const date = timestamp ? new Date(timestamp) : null;
  return date && !Number.isNaN(date.getTime()) ? formatWhen(date, loc, 'day') : null;
};

/**
 * The top of the Social tab: how the connected accounts are actually doing.
 *
 * Read live from Meta after the screen is up, so the planner never waits on
 * it, and kept to what each account can answer: a refused metric drops out
 * rather than showing as a zero.
 */
export function SocialInsights() {
  const [platforms, setPlatforms] = useState<PlatformInsights[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const settings = useSettings();

  function load() {
    startLoading(async () => {
      const result = await safeAction(loadSocialInsightsAction, (message) => ({ success: false, message, platforms: [] }))();
      setProblem(result.success ? null : result.message);
      if (result.success) setPlatforms(result.platforms);
    });
  }

  useEffect(() => load(), []);

  const connected = platforms?.filter((item) => item.state !== 'not-connected') ?? [];
  const openConnections = () => settings?.open('connections');

  return (
    <section className="so-insights" aria-labelledby="so-insights-title">
      <div className="so-insights-head">
        <h2 id="so-insights-title" className="so-h">Insights</h2>
        {connected.length > 0 && (
          <button type="button" className="fd-link" onClick={load} disabled={isLoading} aria-label="Refresh insights">
            <RefreshCw size={13} aria-hidden="true" className={isLoading ? 'so-spin' : undefined} /> {isLoading ? 'Loading' : 'Refresh'}
          </button>
        )}
      </div>

      {problem && <p className="so-problem">{problem}</p>}
      {!platforms && !problem && <p className="so-summary" aria-busy="true">Loading your numbers…</p>}

      {platforms && !connected.length && (
        <p className="so-summary">
          Connect Instagram or Threads to see followers, reach and how each post did.{' '}
          {settings && <button type="button" className="fd-link" onClick={openConnections}>Connect accounts</button>}
        </p>
      )}

      {connected.map((item) => <PlatformCard key={item.platform} item={item} onReconnect={settings ? openConnections : null} />)}
    </section>
  );
}

function PlatformCard({ item, onReconnect }: Readonly<{ item: PlatformInsights; onReconnect: (() => void) | null }>) {
  const name = NAMES[item.platform];
  const reconnect = onReconnect && <button type="button" className="fd-link" onClick={onReconnect}>Reconnect {name}</button>;

  return (
    <article className="so-insight-card">
      <header className="so-insight-top">
        <span className="pf-app-tile"><BrandMark id={item.platform} /></span>
        <span className="fd-two">
          {name}
          {item.state === 'ready' && item.username && <small>@{item.username}</small>}
        </span>
        {item.state === 'ready' && item.followers !== null && (
          <span className="so-followers"><b>{compactCount(item.followers)}</b> followers</span>
        )}
      </header>

      {item.state === 'reconnect' && <p className="so-problem">{item.message} {reconnect}</p>}

      {item.state === 'ready' && (
        <>
          {item.totals.length > 0 && (
            <>
              <p className="so-window">Last {item.windowDays} days</p>
              <dl className="so-stats">
                {item.totals.map((metric) => (
                  <div key={metric.key}>
                    <dt>{metric.label}</dt>
                    <dd>{compactCount(metric.value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {item.insightsBlocked && (
            <p className="so-summary">Reach and views need one more permission. {reconnect}</p>
          )}
          {item.recent.length > 0 ? (
            <ul className="st-cards so-insight-cards">
              {item.recent.map((post) => <RecentPost key={post.id} post={post} platform={item.platform} username={item.username} />)}
            </ul>
          ) : (
            <p className="so-summary">No posts on {name} yet.</p>
          )}
        </>
      )}
    </article>
  );
}

/** A post as it went out: the same Instagram-style card as a planned post, opening the post itself. */
function RecentPost({ post, platform, username }: Readonly<{ post: InsightPost; platform: PlatformInsights['platform']; username: string | null }>) {
  // An expired CDN link shows a quiet placeholder, not the browser's broken-image icon.
  const [broken, setBroken] = useState(false);
  const loc = usePersonLocale();
  const date = when(post.timestamp, loc);
  const who = username ? `@${username}` : NAMES[platform];
  const body = (
    <>
      <span className="st-card-head">
        <span className="st-card-brand" aria-hidden="true"><BrandMark id={platform} /></span>
        <span className="st-card-who">{who}</span>
        {date && <span className="st-card-day">{date}</span>}
      </span>
      <span className="st-card-media">
        {post.thumbnail && !broken ? (
          // Meta's CDN URLs are signed and short-lived, so next/image's cache would only hold dead links.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailSrc(post.thumbnail)} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : <span className="st-card-tint st-card-blank"><ImageOff size={22} aria-hidden="true" /></span>}
      </span>
      {post.text && <span className="st-card-caption"><b>{who}</b> {post.text}</span>}
      <span className="st-card-chips">
        {post.metrics.map((metric) => <span key={metric.key} className="st-chip">{compactCount(metric.value)} {metric.label.toLowerCase()}</span>)}
        {post.permalink && <span className="st-chip st-chip-out">Open on {NAMES[platform]}<ExternalLink size={11} aria-hidden="true" /></span>}
      </span>
    </>
  );
  return (
    <li>
      <article className="st-card">
        {post.permalink
          ? <a className="st-card-open" href={post.permalink} target="_blank" rel="noreferrer" aria-label={`Open on ${NAMES[platform]}: ${post.text || 'post'}`}>{body}</a>
          : <div className="st-card-open">{body}</div>}
      </article>
    </li>
  );
}
