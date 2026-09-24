'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Lightbulb, ListChecks, LoaderCircle, Sparkles, Trash2 } from 'lucide-react';
import { deleteSavedAiResultAction } from '@/app/ai/result-actions';
import { generatePortfolioAdviceAction } from '@/app/invest/ai-actions';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import type { PortfolioAdvice } from '@/lib/invest/types';
import { safeAction } from '@/lib/client/safe-action';

const KIND = {
  risk: { label: 'Risk', icon: AlertTriangle },
  opportunity: { label: 'Opportunity', icon: Lightbulb },
  action: { label: 'Next step', icon: ListChecks },
} as const;

function savedWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

export function PortfolioAi({ goalCount, saved }: { goalCount: number; saved: SavedPortfolioAdvice | null }) {
  const [consent, setConsent] = useState(false);
  const [includeGoals, setIncludeGoals] = useState(goalCount > 0);
  // Suggestions generated earlier are shown again instead of being regenerated.
  const [advice, setAdvice] = useState<PortfolioAdvice | null>(saved?.result ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(saved?.createdAt ?? null);
  const [savedId, setSavedId] = useState<string | null>(saved?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function request() {
    if (!consent) return;
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(generatePortfolioAdviceAction)({ consented: true, includeGoals: includeGoals && goalCount > 0 });
      if (result.success) {
        setAdvice(result.data);
        setSavedAt(result.saved?.createdAt ?? new Date().toISOString());
        setSavedId(result.saved?.id ?? null);
      } else setMessage(result.message);
    });
  }

  function discard() {
    setMessage(null);
    startTransition(async () => {
      if (savedId) {
        const result = await safeAction(deleteSavedAiResultAction)(savedId);
        if (!result.success) {
          setMessage(result.message);
          return;
        }
      }
      setAdvice(null);
      setSavedAt(null);
      setSavedId(null);
      setConsent(false);
    });
  }

  const shared = ['your holdings and allocation', includeGoals && goalCount > 0 ? 'your goals' : null].filter(Boolean).join(' and ');

  return (
    <section className="invest-ai" aria-labelledby="invest-ai-title">
      <div className="invest-ai-head">
        <div className="invest-ai-icon"><Sparkles size={18} aria-hidden="true" /></div>
        <div><small>ORBIS AI</small><h3 id="invest-ai-title">Portfolio suggestions</h3></div>
      </div>

      {!advice ? (
        <div className="workbook-consent">
          {goalCount > 0 && <label><input type="checkbox" checked={includeGoals} onChange={(event) => { setIncludeGoals(event.currentTarget.checked); setConsent(false); }} disabled={isPending} /> Use my {goalCount} {goalCount === 1 ? 'goal' : 'goals'} to tailor the suggestions.</label>}
          <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} disabled={isPending} /> I understand {shared} will be sent to OpenRouter for analysis. The suggestions are saved to your account so you can read them again; your holdings are not stored.</label>
          <button className="finance-button primary" type="button" onClick={request} disabled={!consent || isPending}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={15} /> Analysing…</> : <><Sparkles size={15} /> Get suggestions</>}
          </button>
        </div>
      ) : (
        <div className="invest-ai-result" aria-live="polite">
          {savedAt && <p className="ai-saved-note">Saved {savedWhen(savedAt)}</p>}
          <p className="invest-ai-summary">{advice.summary}</p>
          {advice.suggestions.map((item, index) => {
            const kind = KIND[item.kind];
            const Icon = kind.icon;
            return (
              <article className={`invest-ai-item ${item.kind}`} key={`${item.title}-${index}`}>
                <em><Icon size={12} aria-hidden="true" />{kind.label}</em>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </article>
            );
          })}
          {advice.caveats.map((caveat, index) => <p className="workbook-caveat" key={`${caveat}-${index}`}>{caveat}</p>)}
          <button className="finance-button secondary" type="button" onClick={discard} disabled={isPending}>
            <Trash2 size={14} /> Delete and ask again
          </button>
        </div>
      )}
      {message && <p className="finance-notice error" role="status">{message}</p>}
      <p className="groww-muted">Educational suggestions, not investment advice. Orbis never places trades.</p>
    </section>
  );
}
