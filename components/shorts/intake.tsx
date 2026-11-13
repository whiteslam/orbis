'use client';

import { useState, type FormEvent } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { queueShortAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import { LIMITS } from '@/lib/shorts/rules';
import type { ShortJob, ShortOptions, Voice } from '@/lib/shorts/types';
import type { StyleCard } from '@/lib/shorts/view';

const LENGTHS = [25, 30, 35, 40, 45, 50, 55, 60];

const PROMPTS: Record<string, string> = {
  'deep-dive': 'What happens if you crack your knuckles?',
  'night-file': 'The Dyatlov Pass incident',
  'inside-out': 'What happens if you swallow a cherry pit?',
  'stick-story': 'What would you do if your car slid into a lake?',
  'paper-atlas': 'How the Great Wall was actually built',
  'tall-tale': 'The man who sold the Eiffel Tower twice',
  'cozy-tales': 'A baby hedgehog who is scared of thunder',
};

/** The skill's intake, as one form: everything it would ask, with its defaults. */
export function Intake({ style, voices, disabledReason, onQueued }: Readonly<{ style: StyleCard; voices: Voice[]; disabledReason: string | null; onQueued: (job: ShortJob) => void }>) {
  const lengths = LENGTHS.filter((seconds) => seconds >= style.secondsMin && seconds <= style.secondsMax);
  const middle = lengths[Math.floor(lengths.length / 2)] ?? style.secondsMin;
  const [topic, setTopic] = useState('');
  const [options, setOptions] = useState<ShortOptions>({ seconds: middle, voice: style.defaultVoice, mode: 'voice', music: 'bed', endLine: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof ShortOptions>(key: K, value: ShortOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const voiceList = voices.length ? voices : [{ id: style.defaultVoice, label: 'the style’s voice' }];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || disabledReason) return;
    setBusy(true);
    setMessage(null);
    const result = await safeAction(queueShortAction)({ style: style.slug, topic, options });
    setBusy(false);
    if (!result.success) return setMessage(result.message);
    onQueued(result.data);
  }

  return (
    <form className="sh-intake" onSubmit={submit}>
      <label className="fd-field">
        What’s the short about?
        <textarea
          rows={3}
          value={topic}
          maxLength={LIMITS.topic}
          placeholder={PROMPTS[style.slug] ?? 'A question, a story or a topic'}
          onChange={(event) => setTopic(event.currentTarget.value)}
          required
        />
      </label>
      <div className="sh-intake-grid">
        <label className="fd-field">
          Length
          <select value={options.seconds} onChange={(event) => set('seconds', Number(event.currentTarget.value))}>
            {lengths.map((seconds) => <option key={seconds} value={seconds}>About {seconds} s</option>)}
          </select>
        </label>
        <label className="fd-field">
          Voice
          <select value={options.voice} onChange={(event) => set('voice', event.currentTarget.value)}>
            {voiceList.map((voice) => <option key={voice.id} value={voice.id}>{voice.id}: {voice.label}</option>)}
          </select>
        </label>
        <label className="fd-field">
          Voiceover
          <select value={options.mode} onChange={(event) => set('mode', event.currentTarget.value === 'captions' ? 'captions' : 'voice')}>
            <option value="voice">AI voice</option>
            <option value="captions">Captions only (no voice yet)</option>
          </select>
        </label>
        <label className="fd-field">
          Music
          <select value={options.music} onChange={(event) => set('music', event.currentTarget.value === 'none' ? 'none' : 'bed')}>
            <option value="bed">Built-in music bed</option>
            <option value="none">No music</option>
          </select>
        </label>
      </div>
      <label className="fd-field">
        End line or handle <span className="sh-optional">optional</span>
        <input value={options.endLine} maxLength={LIMITS.endLine} placeholder="@yourchannel" onChange={(event) => set('endLine', event.currentTarget.value)} />
      </label>
      {(message || disabledReason) && <p className="fd-msg bad" role="alert">{message ?? disabledReason}</p>}
      <div className="sh-actions">
        <button type="submit" className="so-action primary" disabled={busy || !topic.trim() || Boolean(disabledReason)}>
          {busy ? <LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          <span>{busy ? 'Queuing…' : 'Generate plan'}</span>
        </button>
      </div>
      <p className="fd-note">Your PC writes the script, captions and shot list first. Nothing is rendered until you approve the plan.</p>
    </form>
  );
}
