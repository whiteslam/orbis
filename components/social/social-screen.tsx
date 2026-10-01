'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { SocialCalendar } from '@/components/social/social-calendar';
import { SocialGrid, SocialList } from '@/components/social/social-list';
import { PostDrawer } from '@/components/social/post-drawer';
import { AiDraftDialog } from '@/components/social/ai-draft-dialog';
import { SocialInsights } from '@/components/social/social-insights';
import { loadSocialMonthAction } from '@/app/social/actions';
import { PERIOD_PATTERN, indiaToday, monthName, monthSummary, periodOfDate, shiftMonth } from '@/lib/social/month';
import { SOCIAL_FORMATS, type SocialFormat, type SocialPost } from '@/lib/social/types';
import type { SocialMonth } from '@/lib/social/repository';
import { safeAction } from '@/lib/client/safe-action';
import type { SocialConnectNotice } from '@/lib/social/connect-notice';

type View = 'calendar' | 'list' | 'grid';
type Screen = { name: 'main' } | { name: 'post'; post: SocialPost | null; date: string | null; format: SocialFormat } | { name: 'ai' };

const VIEWS: Array<[View, string]> = [['calendar', 'Calendar'], ['list', 'List'], ['grid', 'Grid']];
const HASH_PREFIX = '#social/';

/** '#social/2026-09' → '2026-09-01', or null. */
function periodFromHash() {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const period = `${hash.slice(HASH_PREFIX.length)}-01`;
  return PERIOD_PATTERN.test(period) ? period : null;
}

/**
 * The Social tab: one month of the user's own posts.
 *
 * The server hands over the current month; other months load on demand. The
 * month lives in the URL hash, so a reload stays where it was.
 */
export function SocialScreen({ initial, hasProfile, connectNotice, clearConnectNotice }: { initial: SocialMonth & { period: string }; hasProfile: boolean; connectNotice?: SocialConnectNotice | null; clearConnectNotice?: () => void }) {
  const [period, setPeriod] = useState(initial.period);
  const [month, setMonth] = useState<SocialMonth>(initial);
  const [view, setView] = useState<View>('calendar');
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [selected, setSelected] = useState<string | null>(() => indiaToday());
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
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

  // A reload onto #social/2026-11 opens that month rather than this one.
  useEffect(() => {
    const fromHash = periodFromHash();
    // Only on first mount: later months are chosen with the switcher.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromHash && fromHash !== initial.period) load(fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server re-reads the current month after every write; take its copy when it is the month on screen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial.period === period) setMonth(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  /** A post was created or changed: show it here, or drop it if it now belongs to another month. */
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

  return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Social" subtitle="Your own posts, planned month by month" />

      {connectNotice && (
        <div className={`finance-notice ${connectNotice.tone === 'success' ? 'success' : connectNotice.tone === 'error' ? 'error' : ''}`} role="status">
          <span>{connectNotice.text}</span>
          <button type="button" onClick={clearConnectNotice} aria-label="Dismiss message">×</button>
        </div>
      )}

      <div className="so-month">
        <button type="button" className="fd-round" aria-label="Previous month" disabled={isLoading} onClick={() => load(shiftMonth(period, -1))}><ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" /></button>
        <div style={{ textAlign: 'center' }}>
          <h2 aria-live="polite">{monthName(period)}</h2>
          <p className="so-summary">{isLoading ? 'Loading…' : ready ? monthSummary(posts) : ' '}</p>
        </div>
        <button type="button" className="fd-round" aria-label="Next month" disabled={isLoading} onClick={() => load(shiftMonth(period, 1))}><ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" /></button>
      </div>

      {!month.databaseReady && <p className="so-problem">Social planning isn’t available right now. Try again later.</p>}
      {month.databaseReady && month.loadError && !isLoading && (
        <p className="so-problem">This month could not be loaded. <button type="button" className="fd-link" onClick={() => load(period)}>Try again</button></p>
      )}

      {ready && (
        <>
          <div className="fd-act">
            <details className="so-new">
              <summary className="fd-button"><Plus size={14} aria-hidden="true" />New</summary>
              <div className="so-new-menu">
                {SOCIAL_FORMATS.map((format) => (
                  <button key={format.id} type="button" onClick={() => newPost(selected && periodOfDate(selected) === period ? selected : null, format.id)}>{format.label}</button>
                ))}
              </div>
            </details>
            <button type="button" className="ghost" onClick={() => setScreen({ name: 'ai' })}><Sparkles size={14} aria-hidden="true" />Draft with AI</button>
          </div>

          {notice && <p className={`so-message${notice.error ? ' error' : ''}`} role="status">{notice.text}</p>}

          {!posts.length && !isLoading ? (
            <section className="fd-focus so-empty">
              <h2>Nothing planned for {monthName(period).split(' ')[0]}.</h2>
              <p>Add a post by hand, or tell Orbis what the month is about and it will draft a few for you to edit. Everything here is private to you.</p>
            </section>
          ) : (
            <>
              <div className="fd-seg so-views" role="radiogroup" aria-label="View">
                {VIEWS.map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => setView(id)}>{label}</button>
                ))}
              </div>
              {view === 'calendar' && (
                <SocialCalendar period={period} posts={posts} today={today} selected={selected} onSelect={setSelected} onOpen={openPost} onNew={(date) => newPost(date)} />
              )}
              {view === 'list' && <SocialList posts={posts} onOpen={openPost} />}
              {view === 'grid' && <SocialGrid posts={posts} onOpen={openPost} />}
            </>
          )}
        </>
      )}

      <SocialInsights />

      <p className="fd-note">Orbis never posts for you. Plan here, publish in the app, then record where it went out.</p>
    </div>
  );
}
