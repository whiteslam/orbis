'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { FieldSubHead } from '@/components/field/field';
import { draftMonthWithAiAction } from '@/app/social/actions';
import { DRAFT_TONES, MAX_BRIEF_LENGTH, MAX_DRAFT_COUNT, type DraftTone } from '@/lib/social/ai-draft';
import { monthName } from '@/lib/social/month';
import { SOCIAL_FORMATS, SOCIAL_PLATFORMS, type SocialFormat, type SocialPlatform, type SocialPost } from '@/lib/social/types';
import { safeAction } from '@/lib/client/safe-action';

const TONE_LABEL: Record<DraftTone, string> = { friendly: 'Friendly', professional: 'Professional', playful: 'Playful', inspiring: 'Inspiring' };

/**
 * Asks for a month of drafts. Only the brief typed here is sent, unless the
 * profile box is ticked. What comes back is added as new drafts; nothing the
 * user already wrote is touched.
 */
export function AiDraftDialog({ period, hasProfile, onClose, onDrafted }: {
  period: string;
  hasProfile: boolean;
  onClose: () => void;
  onDrafted: (posts: SocialPost[], message: string) => void;
}) {
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(8);
  const [formats, setFormats] = useState<SocialFormat[]>(['post', 'reel']);
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['instagram']);
  const [tone, setTone] = useState<DraftTone>('friendly');
  const [useProfile, setUseProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);

  function generate() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(draftMonthWithAiAction)({ period, brief, count, formats, platforms, tone, useProfile });
      if (result.success && result.posts) onDrafted(result.posts, result.message);
      else setMessage(result.message);
    });
  }

  return (
    <div>
      <FieldSubHead
        crumb={`Social · ${monthName(period)}`}
        title="Draft with AI"
        lead="Say what the month is about. Orbis adds new drafts spread across the month; you edit them before anything is marked ready."
        onClose={onClose}
        backLabel="Close"
      />
      <form className="fd-form" onSubmit={(event) => { event.preventDefault(); generate(); }}>
        <label className="fd-field wide">What is this month about?
          <textarea rows={5} value={brief} maxLength={MAX_BRIEF_LENGTH} required disabled={isPending} placeholder="Launching my autumn menu, a behind-the-scenes week, two customer stories…" onChange={(event) => setBrief(event.currentTarget.value)} />
        </label>
        <p className="so-counter"><span>{brief.length.toLocaleString('en-IN')} / {MAX_BRIEF_LENGTH.toLocaleString('en-IN')}</span></p>

        <label className="fd-field wide">How many posts
          <select value={count} disabled={isPending} onChange={(event) => setCount(Number(event.currentTarget.value))}>
            {Array.from({ length: MAX_DRAFT_COUNT }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>

        <fieldset className="fd-chips">
          <legend className="fd-label">Formats</legend>
          <div>
            {SOCIAL_FORMATS.map((format) => (
              <button key={format.id} type="button" aria-pressed={formats.includes(format.id)} disabled={isPending} onClick={() => setFormats(toggle(formats, format.id))}>{format.label}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="fd-chips">
          <legend className="fd-label">Platforms</legend>
          <div>
            {SOCIAL_PLATFORMS.map((platform) => (
              <button key={platform.id} type="button" aria-pressed={platforms.includes(platform.id)} disabled={isPending} onClick={() => setPlatforms(toggle(platforms, platform.id))}>{platform.label}</button>
            ))}
          </div>
        </fieldset>

        <div className="fd-seg" role="radiogroup" aria-label="Tone">
          {DRAFT_TONES.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={tone === value} disabled={isPending} onClick={() => setTone(value)}>{TONE_LABEL[value]}</button>
          ))}
        </div>

        <label className="fd-check fd-toggle">
          <input type="checkbox" checked={useProfile} disabled={isPending || !hasProfile} onChange={(event) => setUseProfile(event.currentTarget.checked)} />
          <span>Use my profile to personalise{hasProfile ? '' : ' (fill in Settings → You first)'}</span>
        </label>
        <p className="fd-note tight">
          {useProfile
            ? 'Your name, work and “More about me” are sent too, and only to a model that does not train on what it receives.'
            : 'Only the brief above is sent. Nothing about you is included.'}
        </p>

        {message && <p className="so-message error" role="alert">{message}</p>}
        <div className="fd-act">
          <button type="submit" disabled={isPending || !brief.trim() || !formats.length}>
            <Sparkles size={14} aria-hidden="true" />{isPending ? 'Drafting… this can take half a minute' : `Draft ${count} ${count === 1 ? 'post' : 'posts'}`}
          </button>
        </div>
      </form>
    </div>
  );
}
