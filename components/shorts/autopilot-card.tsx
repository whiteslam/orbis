'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, MoonStar } from 'lucide-react';
import { loadAutopilotAction, saveAutopilotAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { Autopilot } from '@/lib/shorts/autopilot';

/** "18:00" as the person reads times, e.g. "6:00 PM". */
const timeLabel = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * Social → Shorts: the daily bedtime story. When it is on, the Shorts PC starts one
 * Cozy Tales short a day from the start time, with a fresh topic, approves its plan
 * itself and puts the video in the YouTube queue, which posts on its own schedule.
 */
export function AutopilotCard() {
  const [loaded, setLoaded] = useState<{ autopilot: Autopilot; ready: boolean } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const take = useCallback((autopilot: Autopilot) => {
    setEnabled(autopilot.enabled);
    setStartTime(autopilot.startTime);
  }, []);

  useEffect(() => {
    void (async () => {
      const result = await safeAction(loadAutopilotAction)();
      if (!result.success) return setMessage({ text: result.message, ok: false });
      setLoaded(result.data);
      take(result.data.autopilot);
    })();
  }, [take]);

  if (!loaded) {
    return message
      ? <p className="fd-msg bad">{message.text}</p>
      : <p className="sh-loading"><LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> Loading…</p>;
  }
  if (!loaded.ready) return <p className="sh-empty">The daily story needs the autopilot migration in Supabase first.</p>;

  const saved = loaded.autopilot;
  const changed = enabled !== saved.enabled || startTime !== saved.startTime;

  async function save(next: { enabled: boolean; startTime: string }) {
    setSaving(true);
    setMessage(null);
    const result = await safeAction(saveAutopilotAction)(next);
    setSaving(false);
    if (!result.success) return setMessage({ text: result.message, ok: false });
    setLoaded({ autopilot: result.data, ready: true });
    take(result.data);
    setMessage({ text: result.data.enabled ? 'On. A new story starts every day.' : 'Off.', ok: true });
  }

  return (
    <div className="sh-auto">
      <label className="sh-auto-row">
        <span className="sh-auto-icon" aria-hidden="true"><MoonStar size={18} /></span>
        <span className="sh-auto-text">
          <b>Daily bedtime story</b>
          <span>A new Cozy Tales short every day, posted by your YouTube schedule.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={saving}
          aria-label="Daily bedtime story"
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setEnabled(next);
            void save({ enabled: next, startTime });
          }}
        />
      </label>
      {enabled && (
        <div className="sh-auto-time">
          <label className="fd-field">
            Start making it at
            <input type="time" value={startTime} required onChange={(event) => setStartTime(event.currentTarget.value)} />
          </label>
          {changed && (
            <button type="button" className="so-action" disabled={saving || !/^\d{2}:\d{2}$/.test(startTime)} onClick={() => void save({ enabled, startTime })}>
              {saving && <LoaderCircle className="workbook-spinner" size={15} aria-hidden="true" />}
              <span>Save</span>
            </button>
          )}
          <p className="sh-yt-sub">
            {saved.lastRunOn ? `Last started ${saved.lastRunOn}. ` : ''}Starts at {timeLabel(saved.startTime)} when your Shorts PC is on. Each takes about 20 minutes.
          </p>
        </div>
      )}
      {message && (message.ok ? <output className="fd-msg ok">{message.text}</output> : <p className="fd-msg bad" role="alert">{message.text}</p>)}
    </div>
  );
}
