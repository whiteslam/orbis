'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, MoonStar } from 'lucide-react';
import { loadAutopilotAction, saveAutopilotAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import { AUTOPILOT_STYLE_LABELS, AUTOPILOT_STYLES, type Autopilot } from '@/lib/shorts/autopilot';
import type { Destination } from '@/lib/shorts/types';

/** "18:00" as the person reads times, e.g. "6:00 PM". */
const timeLabel = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const TIME = /^\d{2}:\d{2}$/;
const DAYS = [1, 2, 3, 4, 5, 6, 7];

type Form = { enabled: boolean; windowStart: string; windowEnd: string; shelfDays: number; destinations: Destination[]; styles: string[] };

const formOf = (autopilot: Autopilot): Form => ({
  enabled: autopilot.enabled,
  windowStart: autopilot.windowStart,
  windowEnd: autopilot.windowEnd,
  shelfDays: autopilot.shelfDays,
  destinations: autopilot.destinations,
  styles: autopilot.styles,
});

/**
 * Social → Shorts: shorts on autopilot. When it is on, the Shorts PC makes bedtime
 * stories, funny true stories or both (taking turns) one at a time inside the build window, until the YouTube queue
 * holds the days of posts asked for. Each plan is approved by the autopilot itself,
 * and the YouTube schedule posts the videos.
 */
export function AutopilotCard() {
  const [loaded, setLoaded] = useState<{ autopilot: Autopilot; ready: boolean } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const take = useCallback((autopilot: Autopilot) => setForm(formOf(autopilot)), []);

  useEffect(() => {
    void (async () => {
      const result = await safeAction(loadAutopilotAction)();
      if (!result.success) return setMessage({ text: result.message, ok: false });
      setLoaded(result.data);
      take(result.data.autopilot);
    })();
  }, [take]);

  if (!loaded || !form) {
    return message
      ? <p className="fd-msg bad">{message.text}</p>
      : <p className="sh-loading"><LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> Loading…</p>;
  }
  if (!loaded.ready) return <p className="sh-empty">The autopilot needs its migrations in Supabase first (202611140001 and 202611140002).</p>;

  const saved = loaded.autopilot;
  const changed = form.windowStart !== saved.windowStart || form.windowEnd !== saved.windowEnd || form.shelfDays !== saved.shelfDays
    || form.styles.join() !== saved.styles.join();
  const valid = TIME.test(form.windowStart) && TIME.test(form.windowEnd) && form.styles.length > 0;
  // Keeps the chosen styles in AUTOPILOT_STYLES order, so the saved list never depends on tap order.
  const toggleStyle = (style: string) => set({
    styles: AUTOPILOT_STYLES.filter((one) => (one === style ? !form.styles.includes(one) : form.styles.includes(one))),
  });
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  async function save(next: Form) {
    setSaving(true);
    setMessage(null);
    const result = await safeAction(saveAutopilotAction)(next);
    setSaving(false);
    if (!result.success) return setMessage({ text: result.message, ok: false });
    setLoaded({ autopilot: result.data, ready: true });
    take(result.data);
    setMessage({ text: result.data.enabled ? 'On. Shorts are made overnight.' : 'Off.', ok: true });
  }

  return (
    <div className="sh-auto">
      <label className="sh-auto-row">
        <span className="sh-auto-icon" aria-hidden="true"><MoonStar size={18} /></span>
        <span className="sh-auto-text">
          <b>Shorts on autopilot</b>
          <span>Made overnight on your Shorts PC and posted by your YouTube schedule.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={form.enabled}
          disabled={saving}
          aria-label="Shorts on autopilot"
          onChange={(event) => {
            // The switch saves at once, with the window and days as last saved.
            const next = { ...formOf(saved), enabled: event.currentTarget.checked };
            setForm(next);
            void save(next);
          }}
        />
      </label>
      {form.enabled && (
        <div className="sh-auto-time">
          <div className="sh-auto-kinds" role="group" aria-label="What to make">
            {AUTOPILOT_STYLES.map((style) => (
              <button key={style} type="button" aria-pressed={form.styles.includes(style)} onClick={() => toggleStyle(style)}>
                {AUTOPILOT_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
          <div className="sh-auto-window" role="group" aria-label="Build between">
            <label className="fd-field">
              Build between
              <input type="time" value={form.windowStart} required onChange={(event) => set({ windowStart: event.currentTarget.value })} />
            </label>
            <label className="fd-field">
              and
              <input type="time" value={form.windowEnd} required onChange={(event) => set({ windowEnd: event.currentTarget.value })} />
            </label>
          </div>
          <label className="fd-field sh-auto-days">
            Keep ready
            <span className="sh-auto-days-input">
              <select value={form.shelfDays} onChange={(event) => set({ shelfDays: Number(event.currentTarget.value) })}>
                {DAYS.map((days) => <option key={days} value={days}>{days}</option>)}
              </select>
              {form.shelfDays === 1 ? 'day' : 'days'}
            </span>
          </label>
          <label className="sh-auto-post">
            <span>Post to <b>YouTube</b></span>
            {/* YouTube is the only place to post until Instagram arrives, so it stays on. */}
            <input type="checkbox" role="switch" checked={form.destinations.includes('youtube')} disabled aria-label="Post to YouTube" readOnly />
          </label>
          {changed && (
            <button type="button" className="so-action" disabled={saving || !valid} onClick={() => void save(form)}>
              {saving && <LoaderCircle className="workbook-spinner" size={15} aria-hidden="true" />}
              <span>Save</span>
            </button>
          )}
          <p className="sh-yt-sub">
            {form.styles.length === 0 ? 'Pick at least one kind. ' : ''}
            {saved.styles.length > 1 ? 'Takes turns between them. ' : ''}Builds one at a time between {timeLabel(saved.windowStart)} and {timeLabel(saved.windowEnd)} while your Shorts PC is awake, until {saved.shelfDays} {saved.shelfDays === 1 ? 'day' : 'days'} of posts are ready.
          </p>
        </div>
      )}
      {message && (message.ok ? <output className="fd-msg ok">{message.text}</output> : <p className="fd-msg bad" role="alert">{message.text}</p>)}
    </div>
  );
}
