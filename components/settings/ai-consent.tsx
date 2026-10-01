'use client';

import { useEffect, useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { aiUsageAction, setAiEnabledAction } from '@/app/home/brief-actions';
import { aiAllowed } from '@/lib/ai/consent';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { UsageSummary } from '@/lib/ai/usage';
import { safeAction } from '@/lib/client/safe-action';

/**
 * The one switch for every AI feature, with what it sends and where.
 *
 * Off until the person turns it on, and turning it on is the consent: the
 * disclosure sits right beside the switch, so agreeing never happens without
 * seeing it. The router checks the same setting before it sends anything, so
 * this is not only a label: with it off, no feature reaches a provider.
 *
 * Every line below matches what the code sends; update it with the prompts.
 */
export function AiConsent({ preferences, onChange }: { preferences: AiPreferences; onChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(aiAllowed(preferences));
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const blocked = preferences.state !== 'ready';
  const reason = preferences.state === 'setup'
    ? 'This setting isn’t available right now.'
    : preferences.state === 'unavailable'
      ? 'This setting could not be loaded. Try again shortly.'
      : null;

  function toggle(next: boolean) {
    setEnabled(next);
    onChange(next);
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(setAiEnabledAction)(next);
      setMessage({ text: result.message, success: result.success });
      if (!result.success) {
        setEnabled(!next);
        onChange(!next);
      }
    });
  }

  return (
    <div className="pf-notify">
      <label className="pf-master">
        <span>
          <strong><Sparkles size={13} aria-hidden="true" /> Use AI features</strong>
          <small>Off until you turn it on. While it is off, nothing is sent to an AI provider and Orbis uses its own wording.</small>
        </span>
        <input type="checkbox" role="switch" aria-label="Use AI features" checked={enabled} onChange={(event) => toggle(event.currentTarget.checked)} disabled={isPending || blocked} />
      </label>
      {reason && <p className="fd-note">{reason}</p>}
      {enabled && <AiUsageLine />}

      <p className="fd-note">When it is on, each feature sends only what it needs, and only when it runs:</p>
      <ul className="pf-scopes">
        <li>Home brief: your first name, this month’s spending total and top category, the routine due now and how many you missed, how many health documents you keep, and the weather. Only if the brief setting below is on.</li>
        <li>Daily notification: your first name, today’s and this month’s spending totals, today’s routines and your notes on them, today’s steps, your fitness persona, and any social posts planned for today.</li>
        <li>Workbook advice: a summary of the file you upload, plus the saved notes, fitness persona, profile and steps you tick.</li>
        <li>Portfolio suggestions: your holdings’ names, values, amounts invested and asset mix.</li>
        <li>Health plans: passages from your health documents, your profile, fitness persona, step averages and your answers.</li>
        <li>Ask Orbis: your question, plus the last six months of only the sources you tick for it: journal entries (moods, tags and the entries that match your question), saved notes, weekly spending totals and top places, weekly routine answers, and weekly step averages.</li>
        <li>Social drafts: your brief for the month and the platforms you chose, plus your profile if you tick “Use my profile”.</li>
      </ul>
      <p className="fd-note">
        Requests go to Groq, Google Gemini, Mistral, OpenRouter or Anthropic (Claude). Anything built from your personal data only goes to a provider that does not train on what it receives: Groq, or Claude, either directly or through OpenRouter set to use only Anthropic and never a provider that keeps data; if none is available, the feature stays off rather than send it elsewhere. Social drafts that don’t use your profile may go to any of them.
      </p>
      <p className="fd-note">
        Before Ask Orbis or Talk to Orbis answers, Jev (a decision model by TypeSafe, through OpenRouter with zero data retention) reads your question, and only your question, to decide whether it needs Claude or a free model can answer it.
      </p>
      {preferences.externalDocumentIndexing && (
        <p className="fd-note">
          One exception: adding a health document sends its text to OpenRouter to index it for search, and building a plan sends a short search from your answers the same way. That index is made by a model that may train on what it receives.
        </p>
      )}
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </div>
  );
}

const rupees = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: amount < 100 ? 2 : 0 }).format(amount);
const plural = (count: number, word: string) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`;

/**
 * What AI has cost this month, read when the panel opens. Free models cost
 * nothing; the rupee figure is Claude, against ORBIS_AI_MONTHLY_BUDGET_INR.
 */
function AiUsageLine() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    let live = true;
    void safeAction(aiUsageAction, () => null)().then((summary) => {
      if (live) setUsage(summary);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!usage) return null;

  const parts = [`This month: ${plural(usage.free.calls, 'free model call')}`];
  if (usage.paid.calls || usage.spentInr > 0) parts.push(`${plural(usage.paid.calls, 'paid call')} (Claude and Jev), ${rupees(usage.spentInr)} of your ${rupees(usage.budgetInr)} budget`);
  const notes = [
    usage.fallbacks ? `${plural(usage.fallbacks, 'answer')} came from a backup model.` : '',
    usage.state === 'warning' ? 'The budget is nearly used, so Claude is only a last resort for the rest of the month.' : '',
    usage.state === 'critical' ? 'The budget is used up, so only free models run until next month.' : '',
  ].filter(Boolean);
  return <p className="fd-note">{`${parts.join('; ')}.`}{notes.length ? ` ${notes.join(' ')}` : ''}</p>;
}
