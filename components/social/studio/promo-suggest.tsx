'use client';

import { useId, useState, useTransition } from 'react';
import { Minus, Plus, Sparkles } from 'lucide-react';
import { suggestPromoPostsAction } from '@/app/social/promo-actions';
import { safeAction } from '@/lib/client/safe-action';
import { PROMO_BRIEF_MAX, PROMO_MAX } from '@/lib/social/promo';
import type { SocialPost } from '@/lib/social/types';

/**
 * The Orbis account's extra row in the composer: an optional focus, how many
 * posts, and Suggest posts. Orbis writes them from its fixed facts and makes a
 * picture for each; they arrive as AI drafts to check, keep or change.
 */
export function PromoSuggest({ period, onSuggested }: Readonly<{ period: string; onSuggested: (posts: SocialPost[], message: string) => void }>) {
  const id = useId();
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(1);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isWorking, startWorking] = useTransition();

  function suggest() {
    setMessage(null);
    startWorking(async () => {
      const result = await safeAction(suggestPromoPostsAction)({ period, count, brief });
      if (result.success && result.posts) {
        onSuggested(result.posts, result.message);
        setMessage({ text: result.message, error: false });
        setBrief('');
      } else setMessage({ text: result.message, error: true });
    });
  }

  return (
    <div className="studio-promo">
      <label htmlFor={`${id}-brief`} className="sr-only">What to focus on (optional)</label>
      <input
        id={`${id}-brief`}
        className="studio-promo-brief"
        maxLength={PROMO_BRIEF_MAX}
        placeholder="What to focus on (optional)"
        value={brief}
        onChange={(event) => setBrief(event.currentTarget.value)}
        disabled={isWorking}
      />
      <div className="studio-promo-row">
        <div className="studio-stepper" role="group" aria-label="How many posts">
          <button type="button" className="studio-icon-btn" onClick={() => setCount((value) => Math.max(1, value - 1))} disabled={isWorking || count <= 1} aria-label="One fewer"><Minus size={15} aria-hidden="true" /></button>
          <output aria-live="polite">{count} {count === 1 ? 'post' : 'posts'}</output>
          <button type="button" className="studio-icon-btn" onClick={() => setCount((value) => Math.min(PROMO_MAX, value + 1))} disabled={isWorking || count >= PROMO_MAX} aria-label="One more"><Plus size={15} aria-hidden="true" /></button>
        </div>
        <button type="button" className="studio-btn studio-promo-go" onClick={suggest} disabled={isWorking}>
          <Sparkles size={16} aria-hidden="true" />{isWorking ? 'Suggesting…' : 'Suggest posts'}
        </button>
      </div>
      <p className={`studio-composer-msg${message?.error ? ' error' : ''}`} aria-live="polite">
        {isWorking ? 'Writing posts and making images… about a minute.' : message?.text}
      </p>
    </div>
  );
}
