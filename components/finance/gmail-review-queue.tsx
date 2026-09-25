'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, Mail, X } from 'lucide-react';
import { confirmFinanceCandidateAction, ignoreFinanceCandidateAction, parseFinanceCandidatesAction } from '@/app/finance/actions';
import type { FinanceCandidateSummary } from '@/lib/finance/types';
import { FieldLabel, FieldSubHead } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

// The server reads unparsed alerts five at a time (lib/finance/sync.ts).
const PARSE_BATCH = 5;

const day = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

function CandidateReviewCard({ candidate }: { candidate: FinanceCandidateSummary }) {
  const router = useRouter();
  const [amount, setAmount] = useState(candidate.amount?.toFixed(2) ?? '');
  const [currency, setCurrency] = useState(candidate.currency ?? 'INR');
  const [direction, setDirection] = useState(candidate.direction ?? 'expense');
  const [merchant, setMerchant] = useState(candidate.merchant ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const needsReview = candidate.parseStatus === 'needs_review';

  function confirm() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(confirmFinanceCandidateAction)({
        candidateId: candidate.id,
        amount,
        currency,
        direction,
        merchant,
        occurredAt: candidate.receivedAt,
      });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  function ignore() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(ignoreFinanceCandidateAction)(candidate.id);
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  const saved = message === 'Transaction saved.' || message?.startsWith('This transaction was already saved') || message?.startsWith('Alert ignored');

  return (
    <article className="fd-alert">
      <div className="fd-alert-head">
        <span><strong>{needsReview ? 'Review transaction details' : 'Add missing transaction details'}</strong><small>{day(candidate.receivedAt)} · Gmail alert</small></span>
        <Mail size={16} strokeWidth={1.8} aria-hidden="true" />
      </div>
      {candidate.reason && <p className="fd-alert-reason">{candidate.reason}</p>}
      <div className="fd-grid">
        <label className="fd-field">Amount<input inputMode="decimal" type="number" min="0.01" step="0.01" max="100000000" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} disabled={isPending} /></label>
        <label className="fd-field">Currency<input autoCapitalize="characters" maxLength={3} value={currency} onChange={(event) => setCurrency(event.currentTarget.value.toUpperCase())} disabled={isPending} /></label>
        {needsReview && <>
          <label className="fd-field">Type<select value={direction} onChange={(event) => setDirection(event.currentTarget.value as 'expense' | 'income')} disabled={isPending}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          <label className="fd-field">Merchant<input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.currentTarget.value)} disabled={isPending} placeholder="Optional" /></label>
        </>}
      </div>
      <div className="fd-act">
        <button type="button" onClick={confirm} disabled={isPending || !amount || !currency}><Check size={13} strokeWidth={2.4} aria-hidden="true" />{isPending ? 'Saving…' : 'Confirm'}</button>
        <button className="ghost" type="button" onClick={ignore} disabled={isPending}><X size={13} strokeWidth={2.4} aria-hidden="true" />Ignore</button>
      </div>
      {message && <p className={`fd-msg ${saved ? 'ok' : 'bad'}`} role="status">{message}</p>}
    </article>
  );
}

/** Gmail alerts that need a person before they count as spending. */
export function GmailReviewQueue({ candidates, unparsedCount, pendingCount, onBack }: { candidates: FinanceCandidateSummary[]; unparsedCount: number; pendingCount: number; onBack: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function parseNextBatch() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(parseFinanceCandidatesAction)();
      setMessage(result.message);
      router.refresh();
    });
  }

  // A total only when every read alert has an amount in the same currency; otherwise it would mislead.
  const currencies = new Set(candidates.map((candidate) => candidate.currency));
  const total = candidates.length && candidates.every((candidate) => candidate.amount !== null) && currencies.size === 1
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: [...currencies][0] ?? 'INR', maximumFractionDigits: 0 }).format(candidates.reduce((sum, candidate) => sum + (candidate.amount ?? 0), 0))
    : null;
  const oldest = candidates.length ? candidates.reduce((min, candidate) => (candidate.receivedAt < min ? candidate.receivedAt : min), candidates[0].receivedAt) : null;
  const batch = Math.min(PARSE_BATCH, unparsedCount);

  return (
    <>
      <FieldSubHead crumb="Expense · Gmail alerts" title="Review before saving" onBack={onBack} backLabel="Back to Expense" />

      <div className="fd-hero">
        <p className="fd-hero-value">{pendingCount}</p>
        <div className="fd-hero-meta">
          <span>{pendingCount === 1 ? 'alert' : 'alerts'} waiting{oldest ? `, oldest ${day(oldest)}` : ''}</span>
          {total && <span className="fd-delta flat">{total} total</span>}
        </div>
      </div>

      <p className="fd-note">Orbis reads plain-text alert details only when you ask. Email content is discarded after parsing, and nothing counts as spending until you confirm it.</p>

      {unparsedCount > 0 && (
        <div className="fd-act">
          <button type="button" onClick={parseNextBatch} disabled={isPending}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Reading alerts…</> : <><Mail size={14} strokeWidth={1.9} aria-hidden="true" /> Read next {batch} alert{batch === 1 ? '' : 's'}</>}
          </button>
          {unparsedCount > batch && <span className="fd-hint">{unparsedCount - batch} more after these</span>}
        </div>
      )}
      {message && <p className="fd-msg" role="status">{message}</p>}

      {candidates.length > 0 && <FieldLabel>Read and waiting</FieldLabel>}
      {candidates.map((candidate) => <CandidateReviewCard key={candidate.id} candidate={candidate} />)}

      <p className="fd-note">Ignoring an alert keeps its Gmail ID so it is never offered again. Confirmed transactions appear under Latest with a mail badge.</p>
    </>
  );
}
