'use client';

import { useEffect, useState, useTransition, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { SocialCalendar } from '@/components/social/social-calendar';
import { SocialGrid, SocialList, dayLabel, type SocialSort } from '@/components/social/social-list';
import { PostDrawer } from '@/components/social/post-drawer';
import { AiDraftDialog } from '@/components/social/ai-draft-dialog';
import { SocialInsights } from '@/components/social/social-insights';
import { loadSocialMonthAction } from '@/app/social/actions';
import { PERIOD_PATTERN, indiaToday, monthName, monthSummary, periodOfDate, shiftMonth } from '@/lib/social/month';
import { SOCIAL_FORMATS, SOCIAL_STATUS_LABEL, type SocialFormat, type SocialPost, type SocialStatus } from '@/lib/social/types';
import type { SocialMonth } from '@/lib/social/repository';
import { safeAction } from '@/lib/client/safe-action';
import type { SocialConnectNotice } from '@/lib/social/connect-notice';

type View = 'list' | 'grid';
type Screen = { name: 'main' } | { name: 'post'; post: SocialPost | null; date: string | null; format: SocialFormat } | { name: 'ai' };

const VIEWS: Array<[View, string]> = [['list', 'List'], ['grid', 'Grid']];
/** The pipeline, in the order a post moves through it. */
const STAGES: SocialStatus[] = ['idea', 'draft', 'ready', 'published'];
const HASH_PREFIX = '#social/';
/** The banner class for each connect result; 'info' takes the plain banner. */
const NOTICE_TONE_CLASS: Record<SocialConnectNotice['tone'], string> = { success: 'success', error: 'error', info: '' };

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
export function SocialScreen({ initial, hasProfile, connectNotice, clearConnectNotice }: Readonly<{ initial: SocialMonth & { period: string }; hasProfile: boolean; connectNotice?: SocialConnectNotice | null; clearConnectNotice?: () => void }>) {
  const [period, setPeriod] = useState(initial.period);
  const [month, setMonth] = useState<SocialMonth>(initial);
  const [view, setView] = useState<View>('list');
  const [sort, setSort] = useState<SocialSort>('status');
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [selected, setSelected] = useState<string | null>(() => indiaToday());
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // Posts made since the screen opened: only these rise into the list.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
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
    if (!month.posts.some((item) => item.id === post.id)) setFresh((current) => new Set(current).add(post.id));
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
  const isThisMonth = period === periodOfDate(today);
  // The one post to act on next: the first not yet out, from today on.
  const nextUp = posts.find((post) => post.status !== 'published' && post.plannedFor !== null && post.plannedFor >= today) ?? null;
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, posts.filter((post) => post.status === stage).length])) as Record<SocialStatus, number>;

  return (
    <div className="screen-body field so-screen">
      <span ref={top} hidden />
      <FieldHead title="Social" subtitle="Your own posts, planned for the month" />

      {connectNotice && (
        <output className={`finance-notice ${NOTICE_TONE_CLASS[connectNotice.tone]}`}>
          <span>{connectNotice.text}</span>
          <button type="button" onClick={clearConnectNotice} aria-label="Dismiss message">×</button>
        </output>
      )}

      {/* The lead: the month, how far along it is, the next post due, and the one way to add. */}
      <header className="so-lead">
        <div className="so-lead-month">
          <div className="so-month-nav">
            <button type="button" className="so-round" onClick={() => load(shiftMonth(period, -1))} disabled={isLoading} aria-label="Previous month"><ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" /></button>
            <h2 className="so-month-name" aria-live="polite">{monthName(period)}</h2>
            <button type="button" className="so-round" onClick={() => load(shiftMonth(period, 1))} disabled={isLoading} aria-label="Next month"><ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></button>
            {!isThisMonth && <button type="button" className="fd-link so-today-link" onClick={() => load(periodOfDate(today))} disabled={isLoading}>This month</button>}
          </div>
          {ready && (
            <p className="so-lead-line">
              {isLoading ? 'Loading the month…' : monthSummary(posts)}
              {!isLoading && nextUp && (
                <>
                  <span className="so-lead-sep" aria-hidden="true" />
                  <button type="button" className="so-next" onClick={() => openPost(nextUp)}>
                    Next up: <b>{nextUp.title}</b>, {nextUp.plannedFor === today ? 'today' : dayLabel(nextUp.plannedFor ?? today)}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        {/* The two ways to add a post: one button, and the AI as a quieter second. */}
        {ready && (
          <div className="so-actions">
            <details className="so-new">
              <summary className="so-action primary">
                <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
                <span>New post</span>
              </summary>
              <div className="so-new-menu">
                {SOCIAL_FORMATS.map((format) => (
                  <button key={format.id} type="button" onClick={() => newPost(selected && periodOfDate(selected) === period ? selected : null, format.id)}>{format.label}</button>
                ))}
              </div>
            </details>
            <button type="button" className="so-action" onClick={() => setScreen({ name: 'ai' })}>
              <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
              <span>Draft with AI</span>
            </button>
          </div>
        )}
      </header>

      {!month.databaseReady && <p className="so-problem">Social planning isn’t available right now. Try again later.</p>}
      {month.databaseReady && month.loadError && !isLoading && (
        <p className="so-problem">This month could not be loaded. <button type="button" className="fd-link" onClick={() => load(period)}>Try again</button></p>
      )}

      {ready && (
        <>
          {notice && <output className={`so-message${notice.error ? ' error' : ''}`}>{notice.text}</output>}

          {/* The planner: the page's signature. Always shown, so an empty month
              still has days to tap and add to. */}
          <SocialCalendar period={period} posts={posts} today={today} selected={selected} loading={isLoading} onSelect={setSelected} onOpen={openPost} onNew={(date) => newPost(date)} />

          {!posts.length && !isLoading ? (
            <section className="so-empty">
              <h2 className="so-h">Nothing planned for {monthName(period).split(' ')[0]}.</h2>
              <p>Pick a day in the planner to add a post to it, or tell Orbis what the month is about and it will draft a few for you to edit. Everything here is private to you.</p>
              <div className="so-empty-act">
                <button type="button" className="fd-link" onClick={() => setScreen({ name: 'ai' })}>Draft a month with AI</button>
              </div>
            </section>
          ) : (
            <section className="so-pipeline" aria-label="Posts this month" aria-busy={isLoading || undefined}>
              {/* One header line: the heading and count on the left; the order and the view on the right. */}
              <div className="so-posts-head">
                <h2 className="so-h">Posts <span className="so-count">{posts.length}</span></h2>
                <div className="so-posts-tools">
                  {view === 'list' && (
                    <select className="so-sort-pick" aria-label="Sort by" value={sort} onChange={(event) => setSort(event.currentTarget.value as SocialSort)}>
                      <option value="status">By stage</option>
                      <option value="date">By date</option>
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

              {/* The pipeline at a glance: each stage's share of the month, always in words too. */}
              <ol className="so-stages" aria-label="Posts by stage">
                {STAGES.map((stage) => (
                  <li key={stage} className={`so-stage so-stage-${stage}`} style={{ '--so-n': counts[stage] } as CSSProperties} data-empty={counts[stage] === 0 || undefined}>
                    <i aria-hidden="true" />
                    <b>{counts[stage]}</b> {SOCIAL_STATUS_LABEL[stage]}
                  </li>
                ))}
              </ol>

              {view === 'list' ? <SocialList posts={posts} onOpen={openPost} sort={sort} fresh={fresh} /> : <SocialGrid posts={posts} onOpen={openPost} fresh={fresh} />}
            </section>
          )}
        </>
      )}

      <SocialInsights />

      <p className="fd-note so-foot">Orbis never posts for you. Plan here, publish in the app, then record where it went out.</p>
    </div>
  );
}
