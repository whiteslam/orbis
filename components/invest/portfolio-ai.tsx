'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Lightbulb, ListChecks, LoaderCircle, Sparkles } from 'lucide-react';
import { generatePortfolioAdviceAction } from '@/app/invest/ai-actions';
import type { PortfolioAdvice } from '@/lib/invest/types';

const KIND = {
  risk: { label: 'Risk', icon: AlertTriangle },
  opportunity: { label: 'Opportunity', icon: Lightbulb },
  action: { label: 'Next step', icon: ListChecks },
} as const;

export function PortfolioAi({ goalCount, hasGroww }: { goalCount: number; hasGroww: boolean }) {
  const [consent, setConsent] = useState(false);
  const [includeGoals, setIncludeGoals] = useState(goalCount > 0);
  const [advice, setAdvice] = useState<PortfolioAdvice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function request() {
    if (!consent) return;
    setMessage(null);
    startTransition(async () => {
      const result = await generatePortfolioAdviceAction({ consented: true, includeGoals: includeGoals && goalCount > 0 });
      if (result.success) setAdvice(result.data);
      else setMessage(result.message);
    });
  }

  const shared = [hasGroww ? 'your Groww holdings' : null, 'your manual holdings and allocation', includeGoals && goalCount > 0 ? 'your goals' : null].filter(Boolean).join(', ');

  return (
    <section className="invest-ai" aria-labelledby="invest-ai-title">
      <div className="invest-ai-head">
        <div className="invest-ai-icon"><Sparkles size={18} aria-hidden="true" /></div>
        <div><small>ORBIS AI</small><h3 id="invest-ai-title">Portfolio suggestions</h3></div>
      </div>

      {!advice ? (
        <div className="workbook-consent">
          {goalCount > 0 && <label><input type="checkbox" checked={includeGoals} onChange={(event) => { setIncludeGoals(event.currentTarget.checked); setConsent(false); }} disabled={isPending} /> Use my {goalCount} {goalCount === 1 ? 'goal' : 'goals'} to tailor the suggestions.</label>}
          <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} disabled={isPending} /> I understand {shared} will be sent to OpenRouter for analysis. Nothing is stored.</label>
          <button className="finance-button primary" type="button" onClick={request} disabled={!consent || isPending}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={15} /> Analysing…</> : <><Sparkles size={15} /> Get suggestions</>}
          </button>
        </div>
      ) : (
        <div className="invest-ai-result" aria-live="polite">
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
          <button className="finance-button secondary" type="button" onClick={() => { setAdvice(null); setConsent(false); }}>Ask again</button>
        </div>
      )}
      {message && <p className="finance-notice error" role="status">{message}</p>}
      <p className="groww-muted">Educational suggestions, not investment advice. Orbis never places trades.</p>
    </section>
  );
}
