'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, LoaderCircle, Pencil, Play, Plug, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react';
import {
  loadYouTubePanelAction, moveQueueItemAction, postNowAction, removeQueueItemAction, retryQueueItemAction, saveScheduleAction, updateQueueItemAction,
  type PostNowState,
} from '@/app/shorts/youtube-actions';
import { YouTubeSheet } from '@/components/shorts/youtube-sheet';
import { safeAction } from '@/lib/client/safe-action';
import type { Result } from '@/lib/shorts/view';
import { MAX_POST_TIMES, type QueueItem, type Schedule, type VideoDetails, type YouTubePanel as Panel } from '@/lib/youtube/types';
import { GOOGLE_RECONNECT_HINT } from '@/lib/providers/google-hint';

const CONNECT_HREF = '/auth/youtube/start';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const PRIVATE_NOTE = 'Uploaded as private: YouTube keeps uploads from unaudited apps private. Make it public in YouTube Studio.';

const POST_NOW_NOTICE: Record<PostNowState, { text: string; ok: boolean }> = {
  published: { text: 'Posted. It’s on YouTube now.', ok: true },
  partial: { text: 'Uploading. It finishes on its own within 10 minutes.', ok: true },
  held: { text: 'YouTube’s upload limit for today is used up. It goes out on the next posting day.', ok: false },
  reconnect: { text: 'YouTube needs you to connect again. The video stays in the queue.', ok: false },
  failed: { text: 'It couldn’t be posted. The reason is under Posted.', ok: false },
  retry: { text: 'That try didn’t work. It stays in the queue, and Post now can try it again.', ok: false },
};

type Notice = { text: string; ok: boolean; part: 'queue' | 'schedule' | 'posted' };
type Loaded = { panel: Panel; held: boolean };

const shortsUrl = (id: string) => `https://youtube.com/shorts/${id}`;
const detailsOf = (item: QueueItem): VideoDetails => ({
  title: item.title, description: item.description, tags: item.tags, categoryId: item.categoryId, privacy: item.privacy, madeForKids: item.madeForKids,
});

function Cover({ src }: Readonly<{ src: string | undefined }>) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="sh-yt-cover" src={src} alt="" loading="lazy" decoding="async" />
    : <span className="sh-yt-cover is-blank" aria-hidden="true"><Play size={14} /></span>;
}

function NoticeLine({ notice, part }: Readonly<{ notice: Notice | null; part: Notice['part'] }>) {
  if (notice?.part !== part) return null;
  return notice.ok ? <output className="fd-msg ok">{notice.text}</output> : <p className="fd-msg bad" role="alert">{notice.text}</p>;
}

/** Connected channel and what's next, or the way to connect. */
function StatusLine({ panel, held }: Readonly<Loaded>) {
  const { connection, schedule, queue, next, configured } = panel;
  if (!configured && connection?.status !== 'connected') {
    return <p className="fd-msg">YouTube isn’t configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>;
  }
  if (!connection) {
    return (
      <div className="sh-yt-status">
        <p>Connect your channel and Orbis posts your queue on the schedule below.</p>
        <a className="so-action primary" href={CONNECT_HREF}><Plug size={15} aria-hidden="true" /><span>Connect YouTube</span></a>
      </div>
    );
  }
  if (connection.status === 'reconnect_required') {
    return (
      <div className="fd-msg bad sh-yt-banner" role="alert">
        <span>Google ended Orbis’s access, so YouTube needs connecting again. {GOOGLE_RECONNECT_HINT}</span>
        <a className="fd-link alert" href={CONNECT_HREF}>Connect again</a>
      </div>
    );
  }
  const channel = connection.channelTitle ?? 'Your channel';
  let line = 'Queue empty';
  if (schedule.paused) line = 'Paused';
  else if (queue.length && next) line = next.startsWith('Uploading') ? next : `Next: ${next}`;
  else if (queue.length) line = `${queue.length} waiting`;
  return (
    <div className="sh-yt-status">
      <p><b>{channel}</b> · {line}</p>
      {held && <p className="sh-yt-sub">YouTube’s upload limit for today is used up. Posting starts again on the next day.</p>}
    </div>
  );
}

const TIME = /^\d{2}:\d{2}$/;

/** "18:00" as the person reads times, e.g. "6:00 PM". */
const timeLabel = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** One more time to offer: three hours after the last, wrapping past midnight, and not one already listed. */
function suggestTime(times: string[]): string {
  const last = times.at(-1) ?? '18:00';
  let [hour, minute] = last.split(':').map(Number);
  for (let tries = 0; tries < 8; tries++) {
    hour = (hour + 3) % 24;
    const next = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (!times.includes(next)) return next;
    minute = (minute + 30) % 60;
  }
  return '12:00';
}

/** Times, days and the pause switch. Keyed on the saved schedule, so a save resets it. */
function ScheduleForm({ schedule, onSaved }: Readonly<{ schedule: Schedule; onSaved: (notice: Notice) => void }>) {
  const [times, setTimes] = useState<string[]>(schedule.postTimes);
  const [days, setDays] = useState<number[]>(schedule.days);
  const [paused, setPaused] = useState(schedule.paused);
  const [saving, setSaving] = useState(false);
  const tidy = [...new Set(times.filter((time) => TIME.test(time)))].sort();
  const changed = tidy.join() !== schedule.postTimes.join() || paused !== schedule.paused || days.join() !== schedule.days.join();
  const duplicate = tidy.length !== times.length;
  const valid = times.length > 0 && times.every((time) => TIME.test(time)) && !duplicate && days.length > 0;

  const toggle = (day: number) => setDays((have) => (have.includes(day) ? have.filter((one) => one !== day) : [...have, day].sort((a, b) => a - b)));
  const setTime = (index: number, value: string) => setTimes((have) => have.map((time, at) => (at === index ? value : time)));
  const removeTime = (index: number) => setTimes((have) => have.filter((_, at) => at !== index));
  const addTime = () => setTimes((have) => [...have, suggestTime([...have].sort())]);

  async function save() {
    setSaving(true);
    const result = await safeAction(saveScheduleAction)({ postTimes: tidy, days, timezone: schedule.timezone, paused });
    setSaving(false);
    onSaved(result.success ? { text: 'Schedule saved.', ok: true, part: 'schedule' } : { text: result.message, ok: false, part: 'schedule' });
  }

  const perDay = tidy.length === 1 ? 'One post a day' : `Up to ${tidy.length} posts a day`;
  const at = tidy.length ? tidy.map(timeLabel).join(', ') : '…';

  return (
    <div className="sh-yt-schedule">
      <fieldset className="sh-yt-times">
        <legend className="sh-yt-legend">Post at</legend>
        {times.map((time, index) => (
          // The list is edited in place and never reordered while editing, so the index is a stable key.
          <div key={index} className="sh-yt-time-row">
            <input
              type="time"
              className="sh-yt-time-input"
              value={time}
              required
              aria-label={`Post time ${index + 1}`}
              onChange={(event) => setTime(index, event.currentTarget.value)}
            />
            {times.length > 1 && (
              <button type="button" className="sh-icon" aria-label={`Remove ${TIME.test(time) ? timeLabel(time) : `time ${index + 1}`}`} onClick={() => removeTime(index)}>
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {times.length < MAX_POST_TIMES && (
          <button type="button" className="fd-link sh-yt-add-time" onClick={addTime}>
            <Plus size={14} aria-hidden="true" /> Add a time
          </button>
        )}
      </fieldset>
      <div className="sh-yt-days" role="group" aria-label="Days to post on">
        {DAYS.map((label, index) => (
          <button key={label} type="button" aria-pressed={days.includes(index + 1)} onClick={() => toggle(index + 1)}>{label}</button>
        ))}
      </div>
      <label className="sh-yt-pause">
        <input type="checkbox" role="switch" checked={paused} onChange={(event) => setPaused(event.currentTarget.checked)} />
        <span>Pause posting</span>
      </label>
      <p className="sh-yt-sub">
        {perDay}, at {at} in {schedule.timezone.replace(/_/g, ' ')}. Each time posts the next short in the queue.
        {duplicate ? ' Two times are the same; change or remove one.' : ''}
        {days.length ? '' : ' Pick at least one day.'}
      </p>
      <div className="sh-actions">
        <button type="button" className="so-action" onClick={() => void save()} disabled={!changed || !valid || saving}>
          {saving && <LoaderCircle className="workbook-spinner" size={15} aria-hidden="true" />}
          <span>Save</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Social → Shorts → YouTube: who's connected and what's next, the queue in
 * posting order, the schedule, and the last 20 posted. Each change reloads it,
 * and onChanged lets Shorts refresh what each short shows about YouTube.
 */
export function YouTubePanel({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; kind: 'move' | 'remove' | 'post' | 'retry' } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<QueueItem | null>(null);

  const reload = useCallback(async () => {
    const result = await safeAction(loadYouTubePanelAction)();
    if (!result.success) return setProblem(result.message);
    const hold = result.data.schedule.holdUntil;
    setLoaded({ panel: result.data, held: hold !== null && Date.parse(hold) > Date.now() });
    setProblem(null);
  }, []);

  // Loads after the screen is up, so Shorts never waits on YouTube.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  if (!loaded) {
    return problem
      ? <p className="fd-msg bad">{problem} <button type="button" className="fd-link" onClick={() => void reload()}>Try again</button></p>
      : <p className="sh-loading"><LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> Loading YouTube…</p>;
  }

  const { panel, held } = loaded;
  if (!panel.ready) {
    return <p className="sh-empty">YouTube posting isn’t set up yet. Apply the YouTube migration in Supabase to use it.</p>;
  }

  const connected = panel.connection?.status === 'connected';
  const queued = panel.queue.filter((item) => item.status === 'queued');

  async function change(id: string, kind: 'move' | 'remove' | 'retry', run: () => Promise<Result<QueueItem[]>>) {
    setBusy({ id, kind });
    setNotice(null);
    const result = await run();
    if (result.success && kind === 'move') setLoaded((have) => have && { ...have, panel: { ...have.panel, queue: result.data } });
    await reload();
    setBusy(null);
    if (!result.success) return setNotice({ text: result.message, ok: false, part: kind === 'retry' ? 'posted' : 'queue' });
    if (kind !== 'move') onChanged();
  }

  /** Retry asks the old upload first; when YouTube already had the video, it says so instead of queueing it. */
  async function retry(id: string) {
    let said: string | null = null;
    await change(id, 'retry', async () => {
      const result = await safeAction(retryQueueItemAction)(id);
      if (!result.success) return result;
      said = result.data.message;
      return { success: true, data: result.data.queue };
    });
    if (said) setNotice({ text: said, ok: true, part: 'posted' });
  }

  async function postNow(id: string) {
    setBusy({ id, kind: 'post' });
    setNotice(null);
    const result = await safeAction(postNowAction)(id);
    await reload();
    setBusy(null);
    setNotice(result.success ? { ...POST_NOW_NOTICE[result.data.state], part: 'queue' } : { text: result.message, ok: false, part: 'queue' });
    onChanged();
  }

  async function saveEdit(item: QueueItem, details: VideoDetails): Promise<string | null> {
    const result = await safeAction(updateQueueItemAction)(item.id, details);
    if (!result.success) return result.message;
    await reload();
    return null;
  }

  return (
    <div className="sh-yt">
      <StatusLine panel={panel} held={held} />
      {problem && <p className="fd-msg bad" role="alert">{problem} <button type="button" className="fd-link" onClick={() => void reload()}>Try again</button></p>}

      <section className="sh-yt-part sh-yt-queue" aria-labelledby="sh-yt-queue">
        <h3 id="sh-yt-queue" className="sh-yt-h">Queue <span className="so-count">{panel.queue.length}</span></h3>
        <NoticeLine notice={notice} part="queue" />
        {panel.queue.length === 0 ? (
          <p className="sh-empty">Open a finished short and choose Add to YouTube. It waits here for its turn.</p>
        ) : (
          <ol className="sh-yt-list">
            {panel.queue.map((item) => {
              const at = queued.findIndex((one) => one.id === item.id);
              const waiting = item.status === 'queued';
              const rowBusy = busy?.id === item.id;
              let meta = 'Uploading now';
              if (waiting) meta = item.privacy[0].toUpperCase() + item.privacy.slice(1);
              else if (!connected) meta = 'Waiting for YouTube to be connected.';
              const removeButton = (
                <button type="button" className="fd-link alert" onClick={() => setConfirmRemove(item.id)} disabled={busy !== null}><Trash2 size={13} aria-hidden="true" /> Remove</button>
              );
              return (
                <li key={item.id} className="sh-yt-row">
                  <Cover src={panel.covers[item.id]} />
                  <div className="sh-yt-main">
                    <b className="sh-yt-title">{item.title}</b>
                    <span className="sh-yt-meta">{meta}</span>
                    {item.error && <span className="sh-yt-error">Last try: {item.error}</span>}
                    {confirmRemove === item.id && (
                      <div className="sh-yt-tools">
                        <span className="sh-yt-ask">Take it out of the queue?</span>
                        <button type="button" className="fd-link alert" onClick={() => { setConfirmRemove(null); void change(item.id, 'remove', () => safeAction(removeQueueItemAction)(item.id)); }}>Remove</button>
                        <button type="button" className="fd-link" onClick={() => setConfirmRemove(null)}>Keep</button>
                      </div>
                    )}
                    {confirmRemove !== item.id && !waiting && <div className="sh-yt-tools">{removeButton}</div>}
                    {confirmRemove !== item.id && waiting && (
                      <div className="sh-yt-tools">
                        <button type="button" className="sh-yt-post" onClick={() => void postNow(item.id)} disabled={busy !== null || !connected} title={connected ? undefined : 'Connect YouTube first'}>
                          {rowBusy && busy?.kind === 'post' ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                          <span>{rowBusy && busy?.kind === 'post' ? 'Posting…' : 'Post now'}</span>
                        </button>
                        <button type="button" className="fd-link" onClick={() => setEditing(item)} disabled={busy !== null}><Pencil size={13} aria-hidden="true" /> Edit</button>
                        {removeButton}
                      </div>
                    )}
                  </div>
                  {waiting && (
                    <div className="sh-yt-order">
                      <button type="button" className="sh-icon" aria-label="Move up" disabled={busy !== null || at <= 0} onClick={() => void change(item.id, 'move', () => safeAction(moveQueueItemAction)(item.id, -1))}><ArrowUp size={15} aria-hidden="true" /></button>
                      <button type="button" className="sh-icon" aria-label="Move down" disabled={busy !== null || at < 0 || at >= queued.length - 1} onClick={() => void change(item.id, 'move', () => safeAction(moveQueueItemAction)(item.id, 1))}><ArrowDown size={15} aria-hidden="true" /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="sh-yt-part sh-yt-sched" aria-labelledby="sh-yt-schedule">
        <h3 id="sh-yt-schedule" className="sh-yt-h">Schedule</h3>
        <ScheduleForm
          key={`${panel.schedule.postTimes.join()}|${panel.schedule.days.join()}|${panel.schedule.paused}`}
          schedule={panel.schedule}
          onSaved={(saved) => { setNotice(saved); if (saved.ok) void reload(); }}
        />
        <NoticeLine notice={notice} part="schedule" />
      </section>

      {panel.posted.length > 0 && (
        <section className="sh-yt-part sh-yt-posted" aria-labelledby="sh-yt-posted">
          <h3 id="sh-yt-posted" className="sh-yt-h">Posted</h3>
          <NoticeLine notice={notice} part="posted" />
          <ol className="sh-yt-list">
            {panel.posted.map((item) => (
              <li key={item.id} className="sh-yt-row">
                <Cover src={panel.covers[item.id]} />
                <div className="sh-yt-main">
                  <b className="sh-yt-title">{item.title}</b>
                  {item.status === 'published' ? (
                    <>
                      <span className="sh-yt-meta">
                        {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Posted'}
                        {item.youtubeId && <> · <a className="fd-link" href={shortsUrl(item.youtubeId)} target="_blank" rel="noopener noreferrer">Watch on YouTube <ExternalLink size={12} aria-hidden="true" /></a></>}
                      </span>
                      {item.publishedPrivacy === 'private' && item.privacy !== 'private' && <span className="sh-yt-sub">{PRIVATE_NOTE}</span>}
                    </>
                  ) : (
                    <>
                      <span className="sh-yt-error">{item.error ?? 'It couldn’t be posted.'}</span>
                      <div className="sh-yt-tools">
                        <button type="button" className="fd-link" onClick={() => void retry(item.id)} disabled={busy !== null}>
                          {busy?.id === item.id ? <LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />} Retry
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {editing && (
        <YouTubeSheet key={editing.id} initial={detailsOf(editing)} editing onSave={(details) => saveEdit(editing, details)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
