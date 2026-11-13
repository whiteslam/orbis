'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { PostDrawer } from '@/components/social/post-drawer';
import { SocialInsights } from '@/components/social/social-insights';
import { Composer } from '@/components/social/studio/composer';
import { LiveColumn } from '@/components/social/studio/live-column';
import { PostCard } from '@/components/social/studio/post-card';
import { PromoSuggest } from '@/components/social/studio/promo-suggest';
import { setPostStatusAction } from '@/app/social/actions';
import { retryPromoImageAction } from '@/app/social/promo-actions';
import { ShortsView } from '@/components/shorts/shorts-view';
import { useShortsData } from '@/components/shorts/use-shorts-data';
import { loadSocialMonthAction } from '@/app/social/actions';
import { PERIOD_PATTERN, todayIn, monthName, periodOfDate, shiftMonth } from '@/lib/social/month';
import { groupPosts, postsFor, type PostGroups } from '@/lib/social/studio';
import type { SocialAccount, SocialFormat, SocialPost } from '@/lib/social/types';
import type { SocialMonth } from '@/lib/social/repository';
import { safeAction } from '@/lib/client/safe-action';
import type { SocialConnectNotice } from '@/lib/social/connect-notice';
import { usePersonLocale } from '@/components/locale/person-locale';

type Area = 'posts' | 'shorts';
type Screen = { name: 'main' } | { name: 'post'; post: SocialPost | null; date: string | null; format: SocialFormat };

const HASH_PREFIX = '#social/';
const SHORTS_HASH = '#social/shorts';
const AREAS: Array<[Area, string]> = [['posts', 'Posts'], ['shorts', 'Shorts']];
const ACCOUNT_KEY = 'orbis.social.account';
/** The banner class for each connect result; 'info' takes the plain banner. */
const NOTICE_TONE_CLASS: Record<SocialConnectNotice['tone'], string> = { success: 'success', error: 'error', info: '' };
/** The month's groups, in the order the page shows them. */
const GROUPS: Array<[keyof PostGroups, string]> = [['comingUp', 'Coming up'], ['noDate', 'No date'], ['pastNotPosted', 'Past, not posted'], ['posted', 'Posted']];

/** '#social/2026-09' → '2026-09-01', or null. */
function periodFromHash() {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const period = `${hash.slice(HASH_PREFIX.length)}-01`;
  return PERIOD_PATTERN.test(period) ? period : null;
}

function readSavedAccount(): SocialAccount {
  try {
    return window.localStorage.getItem(ACCOUNT_KEY) === 'orbis' ? 'orbis' : 'me';
  } catch {
    return 'me';
  }
}

function saveAccount(account: SocialAccount) {
  try {
    window.localStorage.setItem(ACCOUNT_KEY, account);
  } catch {
    // A remembered tab is a convenience only.
  }
}

/**
 * The Social tab, design 03 "Studio split": on the left a write-and-attach
 * composer and the month's posts as Instagram-style cards; on the right what
 * the Shorts PC is doing. Shorts is the second tab, in the same frame.
 *
 * The server hands over the current month; other months load on demand. The
 * month (or #social/shorts) lives in the URL hash, so a reload stays put.
 */
export function SocialScreen({ initial, isOwner, ownName, connectNotice, clearConnectNotice }: Readonly<{
  initial: SocialMonth & { period: string };
  isOwner: boolean;
  /** How the person's own posts are signed on the cards. */
  ownName: string;
  connectNotice?: SocialConnectNotice | null;
  clearConnectNotice?: () => void;
}>) {
  const { timeZone } = usePersonLocale();
  const [period, setPeriod] = useState(initial.period);
  const [month, setMonth] = useState<SocialMonth>(initial);
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [area, setArea] = useState<Area>('posts');
  const [account, setAccount] = useState<SocialAccount>('me');
  const [openJob, setOpenJob] = useState<{ id: string | null; key: number }>({ id: null, key: 0 });
  const [isLoading, startLoading] = useTransition();
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const shorts = useShortsData();
  const top = useScrollTop(screen.name === 'post' ? `post-${screen.post?.id ?? 'new'}` : `${screen.name}-${area}`);
  const today = todayIn(timeZone);

  function load(next: string) {
    setPeriod(next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${HASH_PREFIX}${next.slice(0, 7)}`);
    startLoading(async () => {
      const result = await safeAction(loadSocialMonthAction, (message) => ({ success: false, message, posts: [], databaseReady: true, loadError: true }))(next);
      setMonth({ posts: result.posts, databaseReady: result.databaseReady, loadError: result.loadError });
    });
  }

  // A reload onto #social/shorts opens Shorts; the owner's last account comes back. Read after mount: the server has neither.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.location.hash.startsWith(SHORTS_HASH)) setArea('shorts');
    if (isOwner) setAccount(readSavedAccount());
  }, [isOwner]);

  // A reload onto #social/2026-11 opens that month rather than this one.
  useEffect(() => {
    const fromHash = periodFromHash();
    // Only on first mount: later months are chosen with the month bar.
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

  /** Posts or Shorts; the hash follows, so a reload stays on the same one. */
  function chooseArea(next: Area) {
    setArea(next);
    const hash = next === 'shorts' ? SHORTS_HASH : `${HASH_PREFIX}${period.slice(0, 7)}`;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  }

  /** From the live column: the Shorts tab, on one short when asked. */
  function openShorts(jobId?: string) {
    setOpenJob((current) => ({ id: jobId ?? null, key: current.key + 1 }));
    chooseArea('shorts');
  }

  /** Keep or a new picture, on one Orbis AI post: one at a time, the result said above the cards. */
  async function onPromoCard(post: SocialPost, run: 'keep' | 'image') {
    setBusyPost(post.id);
    setNotice(null);
    const result = run === 'keep'
      ? await safeAction(setPostStatusAction)(post.id, 'ready')
      : await safeAction(retryPromoImageAction)(post.id);
    if (result.success && result.post) upsert(result.post);
    setNotice({ text: result.message, error: !result.success });
    setBusyPost(null);
  }

  function promoActions(post: SocialPost) {
    if (post.account !== 'orbis' || post.source !== 'ai' || post.status === 'published') return undefined;
    const busy = busyPost === post.id;
    return (
      <>
        {!post.mediaPath && <p className="st-card-note">Image couldn’t be made. Try another image.</p>}
        {post.status !== 'ready' && <button type="button" className="st-pill st-card-btn st-card-keep" disabled={busy} onClick={() => void onPromoCard(post, 'keep')}>Keep</button>}
        <button type="button" className="st-pill st-card-btn" disabled={busy} onClick={() => void onPromoCard(post, 'image')}>{busy ? 'Working…' : 'Try another image'}</button>
        <button type="button" className="st-pill st-card-btn" disabled={busy} onClick={() => openPost(post)}>Edit</button>
      </>
    );
  }

  function chooseAccount(next: SocialAccount) {
    setAccount(next);
    saveAccount(next);
  }

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

  const ready = month.databaseReady && !month.loadError;
  const groups = groupPosts(postsFor(month.posts, account), today);
  const shown = GROUPS.filter(([key]) => groups[key].length > 0);
  const accountName = account === 'orbis' ? 'Orbis' : ownName;
  const isThisMonth = period === periodOfDate(today);

  return (
    <div className="screen-body field so-screen st-screen">
      <span ref={top} hidden />
      <FieldHead title="Social" />

      <div className="st-tabs" role="tablist" aria-label="Social area">
        {AREAS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={area === id} onClick={() => chooseArea(id)}>{label}</button>
        ))}
      </div>

      {connectNotice && (
        <output className={`finance-notice ${NOTICE_TONE_CLASS[connectNotice.tone]}`}>
          <span>{connectNotice.text}</span>
          <button type="button" onClick={clearConnectNotice} aria-label="Dismiss message">×</button>
        </output>
      )}

      <div className="st-frame">
        <LiveColumn data={shorts} onOpenShorts={openShorts} />

        <div className="st-main">
          {area === 'shorts' ? (
            <ShortsView key={openJob.key} data={shorts} openJobId={openJob.id} />
          ) : (
            <>
              {isOwner && (
                <div className="st-accounts" role="radiogroup" aria-label="Account">
                  <button type="button" role="radio" aria-checked={account === 'me'} onClick={() => chooseAccount('me')}>Me</button>
                  <button type="button" role="radio" aria-checked={account === 'orbis'} onClick={() => chooseAccount('orbis')}>Orbis</button>
                </div>
              )}

              <Composer
                account={account}
                period={period}
                onAdded={(post) => upsert(post)}
                extra={isOwner && account === 'orbis' ? <PromoSuggest period={period} onSuggested={(posts) => posts.forEach(upsert)} /> : undefined}
              />

              <div className="st-month">
                <button type="button" className="so-round" onClick={() => load(shiftMonth(period, -1))} disabled={isLoading} aria-label="Previous month"><ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" /></button>
                <h2 className="st-month-name" aria-live="polite">{monthName(period)}</h2>
                <button type="button" className="so-round" onClick={() => load(shiftMonth(period, 1))} disabled={isLoading} aria-label="Next month"><ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></button>
                {!isThisMonth && <button type="button" className="fd-link" onClick={() => load(periodOfDate(today))} disabled={isLoading}>This month</button>}
              </div>

              {!month.databaseReady && <p className="so-problem">Social planning isn’t available right now. Try again later.</p>}
              {month.databaseReady && month.loadError && !isLoading && (
                <p className="so-problem">This month could not be loaded. <button type="button" className="fd-link" onClick={() => load(period)}>Try again</button></p>
              )}

              {notice && <output className={`st-notice${notice.error ? ' error' : ''}`}>{notice.text}</output>}

              {ready && !shown.length && !isLoading && <p className="st-empty">Nothing here yet. Write your first post above.</p>}

              {ready && shown.map(([key, label]) => (
                <section key={key} className="st-group" aria-label={label} aria-busy={isLoading || undefined}>
                  <h2 className="so-h">{label} <span className="so-count">{groups[key].length}</span></h2>
                  <ul className="st-cards">
                    {groups[key].map((post) => (
                      <li key={post.id}><PostCard post={post} accountName={accountName} onOpen={openPost} actions={promoActions(post)} /></li>
                    ))}
                  </ul>
                </section>
              ))}

              <SocialInsights />

              <p className="fd-note so-foot">Orbis never posts for you. Plan here, publish in the app, then record where it went out.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
