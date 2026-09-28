'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { setHomeBriefEnabledAction } from '@/app/home/brief-actions';
import { AiConsent } from '@/components/personal/ai-consent';
import { aiAllowed } from '@/lib/ai/consent';
import type { AiPreferences } from '@/lib/ai/preferences';
import { safeAction } from '@/lib/client/safe-action';

/**
 * The AI switch, then the opt-in for the written brief.
 *
 * Both are off by default and stated plainly: Home is the landing screen, so a
 * brief that wrote itself would send the user's spending to a model provider
 * before they had asked for anything at all. The brief setting only matters
 * once AI is on; with AI off, the router sends nothing whatever it says.
 */
export function HomeBriefSetting({ preferences }: { preferences: AiPreferences }) {
  const [enabled, setEnabled] = useState(preferences.homeBriefEnabled);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [aiOn, setAiOn] = useState(aiAllowed(preferences));

  const blocked = preferences.state !== 'ready' || !preferences.configured || !aiOn;
  const reason = preferences.state !== 'ready'
    ? null // the AI switch above already says why
    : !aiOn
      ? 'Turn on AI features above first. Until then the brief stays in Orbis’s own wording.'
      : !preferences.configured
        ? 'AI writing isn’t available right now, so the brief stays in Orbis’s own wording.'
        : null;

  function toggle(next: boolean) {
    setEnabled(next);
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(setHomeBriefEnabledAction)(next);
      setMessage({ text: result.message, success: result.success });
      if (!result.success) setEnabled(!next);
    });
  }

  return (
    <>
    <AiConsent preferences={preferences} onChange={setAiOn} />
    <div className="pf-notify">
      <label className="pf-master">
        <span>
          <strong><Sparkles size={13} aria-hidden="true" /> Let Orbis write the brief</strong>
          <small>This month’s spending total and top category, your routines and the weather are sent to the AI provider to be written up. Never your transactions, emails or documents.</small>
        </span>
        <input type="checkbox" role="switch" aria-label="Let Orbis write the brief" checked={enabled} onChange={(event) => toggle(event.currentTarget.checked)} disabled={isPending || blocked} />
      </label>
      {reason && <p className="fd-note">{reason}</p>}
      {!reason && preferences.state === 'ready' && (
        <p className="fd-note">
          {enabled
            ? 'Rewritten when the numbers behind it change, not on a timer, so it costs one request per real change. Turn this off and nothing is sent.'
            : 'Off. The brief is composed on your device from the same numbers, and nothing leaves it.'}
        </p>
      )}
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </div>
    </>
  );
}
