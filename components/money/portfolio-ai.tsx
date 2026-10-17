'use client';

import { useState, useTransition } from 'react';
import { LoaderCircle, Sparkles, Trash2 } from 'lucide-react';
import { deleteSavedAiResultAction } from '@/app/ai/result-actions';
import { generatePortfolioAdviceAction } from '@/app/invest/ai-actions';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import { FieldLabel, FieldStep, FieldSubHead } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

const KIND_LABEL = { risk: 'Risk', opportunity: 'Opportunity', action: 'Next step' } as const;

function savedWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

const LINE_BREAKS = new Set(['\n', '\r', '\u2028', '\u2029']);
const SENTENCE_END = new Set(['.', '!', '?']);
const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

// The summary's first sentence becomes the headline; the rest reads under it.
// A scan rather than a regex, so a long summary can't backtrack: the headline
// is the shortest single-line run ending in . ! or ? that is followed by
// whitespace and then more text, and the body is that text.
function splitSummary(summary: string) {
  for (let end = 1; end < summary.length; end += 1) {
    if (LINE_BREAKS.has(summary[end - 1])) break;
    if (!SENTENCE_END.has(summary[end]) || !isSpace(summary[end + 1])) continue;
    let start = end + 1;
    while (start < summary.length && isSpace(summary[start])) start += 1;
    // Whitespace to the very end: the last of it is the body, as the regex had it.
    if (start === summary.length) start -= 1;
    if (start > end + 1) return { headline: summary.slice(0, end + 1), body: summary.slice(start) };
  }
  return { headline: summary, body: null };
}

function context(saved: SavedPortfolioAdvice) {
  const { positionCount } = saved.context as { positionCount?: unknown };
  return { positionCount: typeof positionCount === 'number' ? positionCount : null };
}

// "3 holdings · saved 4 Oct, 9:15 am", or just when it was saved.
function adviceMeta(advice: SavedPortfolioAdvice) {
  const { positionCount } = context(advice);
  const saved = `saved ${savedWhen(advice.createdAt)}`;
  if (positionCount === null) return saved;
  return `${positionCount} ${positionCount === 1 ? 'holding' : 'holdings'} · ${saved}`;
}

/** The consent step: what will be sent, and the box to tick before asking. */
function AskStep({ hasSaved, onBackToSaved, onBack, consent, onConsent, isPending, onRequest, message }: Readonly<{ hasSaved: boolean; onBackToSaved: () => void; onBack: () => void; consent: boolean; onConsent: (consent: boolean) => void; isPending: boolean; onRequest: () => void; message: string | null }>) {
  return (
    <>
      <FieldSubHead crumb="Investments · suggestions" title="Ask about your mix" lead="Orbis sends a summary of your holdings for analysis and saves the suggestions so you can read them again. Your holdings themselves are not stored." onBack={hasSaved ? onBackToSaved : onBack} backLabel={hasSaved ? 'Back to saved suggestions' : 'Back to Investments'} />

      <section className="fd-quiet">
        <h2>What will be sent</h2>
        <div className="fd-line"><span>Holdings summary</span><b className="fd-yes">Included</b></div>
        <div className="fd-line"><span>Personal profile</span><b className="empty">Not sent</b></div>
        <div className="fd-line"><span>Account numbers or keys</span><b className="empty">Never sent</b></div>
      </section>

      <label className="fd-consent">
        <input type="checkbox" checked={consent} onChange={(event) => onConsent(event.currentTarget.checked)} disabled={isPending} />
        <span>I understand a summary of my holdings will be sent to an AI provider that does not train on it (Groq, or Claude by Anthropic) for analysis.</span>
      </label>

      <div className="fd-act">
        <button type="button" onClick={onRequest} disabled={!consent || isPending}>
          {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Analysing…</> : <><Sparkles size={14} aria-hidden="true" /> Get suggestions</>}
        </button>
      </div>
      {message && <output className="fd-msg bad">{message}</output>}
      <p className="fd-note">Educational suggestions, not investment advice. Orbis never places trades.</p>
    </>
  );
}

/** The Invest screen's entry to suggestions: what is saved, or an offer to ask. */
export function PortfolioAiRow({ advice, onOpen }: Readonly<{ advice: SavedPortfolioAdvice | null; onOpen: () => void }>) {
  return (
    <section className="fd-quiet">
      <h2>Suggestions</h2>
      <div className="fd-line">
        <span>{advice ? `Saved ${savedWhen(advice.createdAt)}. ${splitSummary(advice.result.summary).headline}` : 'Orbis can read the shape of your mix and say where it is concentrated.'}</span>
        <button className="fd-link" type="button" onClick={onOpen}>{advice ? 'Read' : 'Ask'}</button>
      </div>
    </section>
  );
}

/** The suggestions view: the consent step, or the saved advice as numbered steps. */
export function PortfolioAi({ advice, setAdvice, onBack }: Readonly<{ advice: SavedPortfolioAdvice | null; setAdvice: (advice: SavedPortfolioAdvice | null) => void; onBack: () => void }>) {
  const [asking, setAsking] = useState(!advice);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function request() {
    if (!consent) return;
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(generatePortfolioAdviceAction)({ consented: true });
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setAdvice({
        id: result.saved?.id ?? '',
        title: null,
        context: {},
        result: result.data,
        createdAt: result.saved?.createdAt ?? new Date().toISOString(),
      });
      setAsking(false);
      setConsent(false);
    });
  }

  function remove() {
    if (!advice) return;
    setMessage(null);
    startTransition(async () => {
      if (advice.id) {
        const result = await safeAction(deleteSavedAiResultAction)(advice.id);
        if (!result.success) {
          setMessage(result.message);
          return;
        }
      }
      setAdvice(null);
      setAsking(true);
    });
  }

  if (asking || !advice) {
    return (
      <AskStep
        hasSaved={Boolean(advice)}
        onBackToSaved={() => setAsking(false)}
        onBack={onBack}
        consent={consent}
        onConsent={setConsent}
        isPending={isPending}
        onRequest={request}
        message={message}
      />
    );
  }

  const { headline, body } = splitSummary(advice.result.summary);
  const meta = adviceMeta(advice);

  return (
    <>
      <FieldSubHead crumb="Investments · suggestions" onBack={onBack} backLabel="Back to Investments" />
      <section className="fd-focus fd-advice" aria-live="polite">
        <p className="fd-kicker">What Orbis sees</p>
        <h1>{headline}</h1>
        {body && <p>{body}</p>}
        <p className="fd-src"><Sparkles size={11} aria-hidden="true" />{meta}</p>
      </section>

      <FieldLabel>{advice.result.suggestions.length} {advice.result.suggestions.length === 1 ? 'step' : 'steps'}</FieldLabel>
      {advice.result.suggestions.map((item, index) => (
        <FieldStep key={`${item.title}-${index}`} n={index + 1} title={item.title} foot={KIND_LABEL[item.kind]}>{item.detail}</FieldStep>
      ))}

      <p className="fd-note">This is not financial advice. Prices move constantly, and Orbis never places trades.</p>
      {advice.result.caveats.map((caveat, index) => <p className="fd-note tight" key={`${caveat}-${index}`}>{caveat}</p>)}

      <section className="fd-quiet">
        <h2>What was sent</h2>
        <div className="fd-line"><span>Holdings summary</span><b className="fd-yes">Included</b></div>
        <div className="fd-line"><span>Personal profile</span><b className="empty">Not sent</b></div>
        <div className="fd-line"><span>Account numbers or keys</span><b className="empty">Never sent</b></div>
      </section>

      <div className="fd-act">
        <button type="button" onClick={() => setAsking(true)} disabled={isPending}>Ask again</button>
        <button className="fd-link alert" type="button" onClick={remove} disabled={isPending}><Trash2 size={13} aria-hidden="true" /> {isPending ? 'Deleting…' : 'Delete this advice'}</button>
      </div>
      {message && <output className="fd-msg bad">{message}</output>}
    </>
  );
}
