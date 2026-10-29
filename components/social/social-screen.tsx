'use client';

import { useEffect, useState, useTransition } from 'react';
import { Plus, RefreshCw, TrendingUp, TrendingDown, Users, Eye } from 'lucide-react';
import { FieldHead, FieldLabel, useScrollTop } from '@/components/field/field';
import { SocialCalendar } from '@/components/social/social-calendar';
import { SocialGrid, SocialList, type SocialSort } from '@/components/social/social-list';
import { PostDrawer } from '@/components/social/post-drawer';
import { AiDraftDialog } from '@/components/social/ai-draft-dialog';
import { SocialInsights } from '@/components/social/social-insights';
import { AiSocialChat } from '@/components/social/ai-social-chat';
import { loadSocialMonthAction } from '@/app/social/actions';
import { PERIOD_PATTERN, indiaToday, monthName, periodOfDate } from '@/lib/social/month';
import { SOCIAL_FORMATS, type SocialFormat, type SocialPost } from '@/lib/social/types';
import type { SocialMonth } from '@/lib/social/repository';
import { safeAction } from '@/lib/client/safe-action';
import type { SocialConnectNotice } from '@/lib/social/connect-notice';

type View = 'list' | 'grid';
type Screen = { name: 'main' } | { name: 'post'; post: SocialPost | null; date: string | null; format: SocialFormat } | { name: 'ai' };

const VIEWS: Array<[View, string]> = [['list', 'List'], ['grid', 'Grid']];
const HASH_PREFIX = '#social/';
const NOTICE_TONE_CLASS: Record<SocialConnectNotice['tone'], string> = { success: 'success', error: 'error', info: '' };

const PLATFORM_TABS = ['Instagram', 'YouTube', 'X', 'TikTok'] as const;
type PlatformTab = typeof PLATFORM_TABS[number];

interface StatTile {
  label: string;
  value: string;
  change: string;
  up: boolean;
}

const MOCK_STATS: Record<PlatformTab, StatTile[]> = {
  Instagram: [
    { label: 'Reach', value: '18.2K', change: '+12%', up: true },
    { label: 'Engagement', value: '3.1%', change: '-0.4%', up: false },
    { label: 'Views', value: '41.6K', change: '+8%', up: true },
    { label: 'New followers', value: '+148', change: '+18%', up: true },
  ],
  YouTube: [
    { label: 'Views', value: '9.4K', change: '+22%', up: true },
    { label: 'Watch time', value: '3.2h', change: '+5%', up: true },
    { label: 'Subscribers', value: '+64', change: '+11%', up: true },
    { label: 'Avg. duration', value: '1:48', change: '-0.2%', up: false },
  ],
  X: [
    { label: 'Impressions', value: '24.1K', change: '+6%', up: true },
    { label: 'Engagements', value: '1.8%', change: '+0.3%', up: true },
    { label: 'Profile visits', value: '3.2K', change: '-2%', up: false },
    { label: 'New followers', value: '+31', change: '+4%', up: true },
  ],
  TikTok: [
    { label: 'Views', value: '52.3K', change: '+34%', up: true },
    { label: 'Likes', value: '4.1K', change: '+28%', up: true },
    { label: 'Comments', value: '312', change: '+15%', up: true },
    { label: 'New followers', value: '+892', change: '+41%', up: true },
  ],
};

const SUGGESTIONS: Array<{ title: string; body: string; type: 'tip' | 'warn' }> = [
  { title: 'Post at 6 PM', body: 'Your audience is most active between 6–8 PM. Schedule your next post then.', type: 'tip' },
  { title: 'Reels engagement dropping', body: 'Reels reach is down 0.4%. Try adding a hook in the first 3 seconds.', type: 'warn' },
];

/** '#social/2026-09' → '2026-09-01', or null. */
function periodFromHash() {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const period = `${hash.slice(HASH_PREFIX.length)}-01`;
  return PERIOD_PATTERN.test(period) ? period : null;
}

/**
 * The Social tab: Gemini-style AI chat at the top, analytics snapshot,
 * then the full month planner (calendar + posts + insights).
 */
export function SocialScreen({ initial, hasProfile, connectNotice, clearConnectNotice }: Readonly<{ initial: SocialMonth & { period: string }; hasProfile: boolean; connectNotice?: SocialConnectNotice | null; clearConnectNotice?: () => void }>) {
  const [period, setPeriod] = useState(initial.period);
  const [month, setMonth] = useState<SocialMonth>(initial);
  const [view, setView] = useState<View>('list');
  const [sort, setSort] = useState<SocialSort>('date');
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [selected, setSelected] = useState<string | null>(() => indiaToday());
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<PlatformTab>('Instagram');
  const [isLoading, startLoading] = useTransition();
  const top = useScrollTop(screen.name === 'post' ? `post-${screen.post?.id ?? 'new'}` : screen.name);
  const today = indiaToday();

  function load(next: string) {
    setPeriod(next);
    setNotice(null);
    setSelected(next === periodOfDate(today) ? today : null);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${HASH_PREFIX}${next.slice(0, 7)}`);
    startLoading(async () => {
      const result = await safeAction(loadSocialMonthAction, (message) => ({ success: false, message, posts: [], databaseReady: true, loadError: true }))(next);
      setMonth({ posts: result.posts, databaseReady: result.databaseReady, loadError: result.loadError });
    });
  }

  useEffect(() => {
    const fromHash = periodFromHash();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromHash && fromHash !== initial.period) load(fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial.period === period) setMonth(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function upsert(post: SocialPost) {
    setMonth((current) => {
      const others = current.posts.filter((item) => item.id !== post.id);
      return { ...current, posts: post.period === period ? [...others, post] : others };
    });
  }
  const removePost = (id: string) => setMonth((current) => ({ ...current, posts: current.posts.filter((item) => item.id !== id) }));
  const openPost = (post: SocialPost) => setScreen({ name: 'post', post, date: null, format: post.format });
  const newPost = (date: string | null, format: SocialFormat = 'post') => setScreen({ name: 'post', post: null, date, format });

  if (screen.name === 'post') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <PostDrawer
        period={screen.post?.period ?? period}
        post={screen.post}
        initialDate={screen.date}
        initialFormat={screen.format}
        onClose={() => setScreen({ name: 'main' })}
        onChanged={upsert}
        onRemoved={removePost}
      />
    </div>
  );

  if (screen.name === 'ai') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <AiDraftDialog
        period={period}
        hasProfile={hasProfile}
        onClose={() => setScreen({ name: 'main' })}
        onDrafted={(posts, message) => {
          posts.forEach(upsert);
          setNotice({ text: message, error: false });
          setView('list');
          setScreen({ name: 'main' });
        }}
      />
    </div>
  );

  const posts = [...month.posts].sort((left, right) => (left.plannedFor ?? '9999').localeCompare(right.plannedFor ?? '9999') || left.position - right.position);
  const ready = month.databaseReady && !month.loadError;
  const stats = MOCK_STATS[activeTab];

  return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Social" subtitle="Your own posts, planned for the month" />

      {connectNotice && (
        <output className={`finance-notice ${NOTICE_TONE_CLASS[connectNotice.tone]}`}>
          <span>{connectNotice.text}</span>
          <button type="button" onClick={clearConnectNotice} aria-label="Dismiss message">×</button>
        </output>
      )}

      {/* ── AI Chat Box ─────────────────────────────────────────────── */}
      <AiSocialChat
        period={period}
        hasProfile={hasProfile}
        onDrafted={(newPosts, message) => {
          newPosts.forEach(upsert);
          setNotice({ text: message, error: false });
        }}
      />

      {/* ── Analytics snapshot ─────────────────────────────────────── */}
      <section className="so-analytics" aria-label="Analytics snapshot">
        {/* Platform tabs */}
        <div className="so-platform-tabs" role="tablist" aria-label="Platform">
          {PLATFORM_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`so-platform-tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Stat tiles — 2×2 grid */}
        <div className="so-stat-grid" role="list">
          {stats.map((stat) => (
            <div key={stat.label} className="so-stat-tile" role="listitem">
              <span className="so-stat-label">{stat.label}</span>
              <span className="so-stat-value">{stat.value}</span>
              <span className={`so-stat-change${stat.up ? ' up' : ' down'}`}>
                {stat.up ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
                {stat.change}
              </span>
            </div>
          ))}
        </div>

        {/* Suggestion cards */}
        <div className="so-suggestions" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <div key={s.title} className={`so-suggestion-card ${s.type}`}>
              <strong className="so-suggestion-title">{s.title}</strong>
              <p className="so-suggestion-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Post actions ────────────────────────────────────────────── */}
      {ready && (
        <div className="so-actions">
          <details className="so-new">
            <summary className="so-action primary">
              <span className="so-action-icon" aria-hidden="true"><Plus size={17} strokeWidth={2.4} /></span>
              <span className="so-action-text"><b>New post</b><small>Post, reel or story</small></span>
            </summary>
            <div className="so-new-menu">
              {SOCIAL_FORMATS.map((format) => (
                <button key={format.id} type="button" onClick={() => newPost(selected && periodOfDate(selected) === period ? selected : null, format.id)}>{format.label}</button>
              ))}
            </div>
          </details>
        </div>
      )}

      {!month.databaseReady && <p className="so-problem">Social planning isn't available right now. Try again later.</p>}
      {month.databaseReady && month.loadError && !isLoading && (
        <p className="so-problem">This month could not be loaded. <button type="button" className="fd-link" onClick={() => load(period)}>Try again</button></p>
      )}

      {ready && (
        <>
          {notice && <output className={`so-message${notice.error ? ' error' : ''}`}>{notice.text}</output>}

          {!posts.length && !isLoading ? (
            <section className="fd-focus so-empty">
              <h2>Nothing planned for {monthName(period).split(' ')[0]}.</h2>
              <p>Add a post by hand, or tell Orbis what the month is about and it will draft a few for you to edit. Everything here is private to you.</p>
            </section>
          ) : (
            <>
              <SocialCalendar period={period} posts={posts} today={today} selected={selected} onSelect={setSelected} onOpen={openPost} onNew={(date) => newPost(date)} />
              <section className="mn-card" aria-label="Posts this month">
                <div className="fd-label-row so-posts-head">
                  <FieldLabel>Posts · {posts.length}</FieldLabel>
                  <div className="so-posts-tools">
                    {view === 'list' && (
                      <select className="so-sort-pick" aria-label="Sort by" value={sort} onChange={(event) => setSort(event.currentTarget.value as SocialSort)}>
                        <option value="date">By date</option>
                        <option value="status">By status</option>
                        <option value="format">By format</option>
                      </select>
                    )}
                    <div className="so-mini" role="radiogroup" aria-label="View">
                      {VIEWS.map(([id, label]) => (
                        <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => setView(id)}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {view === 'list' ? <SocialList posts={posts} onOpen={openPost} sort={sort} /> : <SocialGrid posts={posts} onOpen={openPost} />}
              </section>
            </>
          )}
        </>
      )}

      <SocialInsights />

      <p className="fd-note">Orbis never posts for you. Plan here, publish in the app, then record where it went out.</p>
    </div>
  );
}
