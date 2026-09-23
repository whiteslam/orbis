'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, Mail, X } from 'lucide-react';
import { confirmFinanceCandidateAction, ignoreFinanceCandidateAction, parseFinanceCandidatesAction } from '@/app/finance/actions';
import type { FinanceCandidateSummary } from '@/lib/finance/types';

function CandidateReviewCard({ candidate }: { candidate: FinanceCandidateSummary }) {
  const router = useRouter();
  const [amount, setAmount] = useState(candidate.amount?.toFixed(2) ?? '');
  const [currency, setCurrency] = useState(candidate.currency ?? 'INR');
  const [direction, setDirection] = useState(candidate.direction ?? 'expense');
  const [merchant, setMerchant] = useState(candidate.merchant ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setMessage(null);
    startTransition(async () => {
      const result = await confirmFinanceCandidateAction({
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
      const result = await ignoreFinanceCandidateAction(candidate.id);
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  return (
    <article className="gmail-review-card">
      <div className="gmail-review-head"><div><strong>{candidate.parseStatus === 'needs_review' ? 'Review transaction details' : 'Add missing transaction details'}</strong><small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(candidate.receivedAt))}</small></div><Mail size={16} aria-hidden="true" /></div>
      {candidate.reason && <p className="gmail-review-reason">{candidate.reason}</p>}
      <div className="gmail-review-fields">
        <label>Amount<input inputMode="decimal" type="number" min="0.01" step="0.01" max="100000000" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} disabled={isPending} /></label>
        <label>Currency<input autoCapitalize="characters" maxLength={3} value={currency} onChange={(event) => setCurrency(event.currentTarget.value.toUpperCase())} disabled={isPending} /></label>
        <label>Type<select value={direction} onChange={(event) => setDirection(event.currentTarget.value as 'expense' | 'income')} disabled={isPending}><option value="expense">Expense</option><option value="income">Income</option></select></label>
        <label className="gmail-review-merchant">Merchant<input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.currentTarget.value)} disabled={isPending} placeholder="Optional" /></label>
      </div>
      <div className="gmail-review-actions">
        <button className="finance-button primary" type="button" onClick={confirm} disabled={isPending || !amount || !currency}><Check size={14} />{isPending ? 'Saving…' : 'Confirm transaction'}</button>
        <button className="finance-button secondary" type="button" onClick={ignore} disabled={isPending}><X size={14} />Ignore</button>
      </div>
      {message && <p className={`gmail-review-message ${message === 'Transaction saved.' || message.startsWith('This transaction was already saved') || message.startsWith('Alert ignored') ? 'success' : ''}`} role="status">{message}</p>}
    </article>
  );
}

export function GmailReviewQueue({ candidates, unparsedCount }: { candidates: FinanceCandidateSummary[]; unparsedCount: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function parseNextBatch() {
    setMessage(null);
    startTransition(async () => {
      const result = await parseFinanceCandidatesAction();
      setMessage(result.message);
      router.refresh();
    });
  }

  if (!unparsedCount && !candidates.length) return null;

  return (
    <section className="gmail-review-queue" aria-labelledby="gmail-review-title">
      <div className="gmail-review-queue-title"><div><small>TRANSACTION ALERTS</small><h3 id="gmail-review-title">Review before saving</h3></div>{unparsedCount > 0 && <span>{unparsedCount} to read</span>}</div>
      <p className="gmail-review-privacy">Orbis reads plain-text alert details only when you request it. Email content is discarded after parsing; nothing is added to expenses until you confirm.</p>
      {unparsedCount > 0 && <button className="finance-button primary gmail-parse-button" type="button" onClick={parseNextBatch} disabled={isPending}><Mail size={15} />{isPending ? <><LoaderCircle className="workbook-spinner" size={14} /> Reading alerts…</> : `Read next ${Math.min(5, unparsedCount)} alert${unparsedCount === 1 ? '' : 's'}`}</button>}
      {message && <p className="gmail-review-message" role="status">{message}</p>}
      <div className="gmail-review-list">{candidates.map((candidate) => <CandidateReviewCard key={candidate.id} candidate={candidate} />)}</div>
    </section>
  );
}
