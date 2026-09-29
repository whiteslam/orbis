'use client';

import { useState, useTransition } from 'react';
import { LoaderCircle } from 'lucide-react';
import { askOrbisAction, type AskResult } from '@/app/ask/actions';
import { safeAction } from '@/lib/client/safe-action';
import { ASK_SOURCES, type AskSource } from '@/lib/ask/select';

const EXAMPLES = [
  'How was my spending in the weeks I felt stressed?',
  'Which days did I skip the gym, and how did I feel?',
  'What have I been grateful for lately?',
];

/**
 * Questions about your own records.
 *
 * Nothing is read until you ask, and only the sources ticked below. The answer
 * lists what it relied on, and anything it cites that was not supplied is
 * dropped before you see it.
 */
export function AskOrbis() {
  const [question, setQuestion] = useState('');
  const [sources, setSources] = useState<AskSource[]>(['journal', 'spending', 'routines']);
  const [result, setResult] = useState<AskResult | null>(null);
  const [asked, setAsked] = useState('');
  const [isPending, startTransition] = useTransition();

  const toggle = (id: AskSource) => setSources((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    setResult(null);
    startTransition(async () => {
      const answer = await safeAction(askOrbisAction)({ question: text, sources });
      setAsked(text);
      setResult(answer);
    });
  }

  return (
    <div className="ak-box">
      <form className="fd-form" onSubmit={ask}>
        <label className="fd-field wide" htmlFor="ask-orbis">Your question
          <textarea id="ask-orbis" rows={2} maxLength={300} value={question} onChange={(event) => setQuestion(event.currentTarget.value)} placeholder={EXAMPLES[0]} disabled={isPending} />
        </label>
        <div className="fd-chips ak-sources" role="group" aria-label="What Orbis may look at">
          <div>
            {ASK_SOURCES.map((source) => (
              <button key={source.id} type="button" aria-pressed={sources.includes(source.id)} onClick={() => toggle(source.id)} disabled={isPending}>{source.label}</button>
            ))}
          </div>
        </div>
        <div className="fd-act pf-act">
          <button type="submit" disabled={isPending || question.trim().length < 5 || !sources.length}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Reading…</> : 'Ask'}
          </button>
        </div>
      </form>

      {!result && !isPending && (
        <div className="ak-examples">
          {EXAMPLES.map((example) => <button key={example} type="button" className="fd-link" onClick={() => setQuestion(example)}>{example}</button>)}
        </div>
      )}

      {result && (result.success ? (
        <article className="ak-answer" aria-live="polite">
          <p className="ak-q">{asked}</p>
          <p className="ak-a">{result.answer}</p>
          {result.citations?.length ? (
            <p className="ak-cites"><span>Based on</span> {result.citations.map((citation) => citation.label).join(' · ')}</p>
          ) : <p className="ak-cites"><span>No specific records cited.</span></p>}
        </article>
      ) : <p className="fd-msg bad" role="status">{result.message}</p>)}

      <p className="fd-note">Orbis reads the last six months of only what you tick, and only when you ask. Questions go to a model that doesn’t train on what it’s sent; if none is available, nothing is sent.</p>
    </div>
  );
}
