'use client';

import { useEffect, useState, useTransition } from 'react';
import { ExternalLink, ImageOff, RefreshCw } from 'lucide-react';
import { loadSocialInsightsAction } from '@/app/social/insights-actions';
import { BrandMark } from '@/components/settings/brand-mark';
import { useSettings } from '@/components/shell/settings-context';
import { safeAction } from '@/lib/client/safe-action';
import { compactCount, thumbnailSrc, type InsightPost, type PlatformInsights } from '@/lib/social/insights-shape';

const NAMES = { instagram: 'Instagram', threads: 'Threads' } as const;
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

const when = (timestamp: string | null) => {
  const date = timestamp ? new Date(timestamp) : null;
  return date && !Number.isNaN(date.getTime()) ? DAY.format(date) : null;
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
        <h2 id="so-insights-title" className="fd-label">Insights</h2>
        {connected.length > 0 && (
          <button type="button" className="fd-link" onClick={load} disabled={isLoading} aria-label="Refresh insights">
            <RefreshCw size={13} aria-hidden="true" className={isLoading ? 'so-spin' : undefined} /> {isLoading ? 'Loading' : 'Refresh'}
          </button>
        )}
      </div>

      {problem && <p className="so-problem">{problem}</p>}
      {!platforms && !problem && <p className="so-summary">Loading your numbers…</p>}

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

function PlatformCard({ item, onReconnect }: { item: PlatformInsights; onReconnect: (() => void) | null }) {
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
            <ul className="so-insight-posts">
              {item.recent.map((post) => <RecentPost key={post.id} post={post} />)}
            </ul>
          ) : (
            <p className="so-summary">No posts on {name} yet.</p>
          )}
        </>
      )}
    </article>
  );
}

function RecentPost({ post }: { post: InsightPost }) {
  // An expired CDN link shows a quiet placeholder, not the browser's broken-image icon.
  const [broken, setBroken] = useState(false);
  const date = when(post.timestamp);
  const body = (
    <>
      <span className="so-thumb so-fmt-post">
        {post.thumbnail && !broken ? (
          // Meta's CDN URLs are signed and short-lived, so next/image's cache would only hold dead links.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailSrc(post.thumbnail)} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : <ImageOff size={15} aria-hidden="true" />}
      </span>
      <span className="so-row-text">
        <strong>{post.text || 'Untitled post'}</strong>
        <small>
          {date && <span>{date}</span>}
          {post.metrics.map((metric) => <span key={metric.key}>{compactCount(metric.value)} {metric.label.toLowerCase()}</span>)}
        </small>
      </span>
      {post.permalink && <ExternalLink size={13} aria-hidden="true" className="so-out" />}
    </>
  );
  return (
    <li>
      {post.permalink
        ? <a className="so-row" href={post.permalink} target="_blank" rel="noreferrer">{body}</a>
        : <div className="so-row">{body}</div>}
    </li>
  );
}
