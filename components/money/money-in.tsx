'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { deleteIncomePlanAction, saveIncomePlanAction } from '@/app/finance/actions';
import { INCOME_CATEGORIES } from '@/lib/finance/manual';
import type { FinanceSummary } from '@/lib/finance/types';
import { FieldLabel } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-IN')}`;
  }
}

const ordinal = (day: number) => {
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
};

/**
 * What came in this month, and where from.
 *
 * Spending had a screen and income had nothing: a transaction could be marked
 * as income with a source such as Freelance or Refund, and that source was
 * written to the database and never read back. So this answers two questions the
 * app already had the data for but never asked. What arrived, split into the
 * salary you expect and the extra money you did not, and which of those sources
 * each pound came from.
 */
export function MoneyIn({ summary, shown, onShown }: { summary: FinanceSummary; shown: boolean; onShown: (next: boolean) => void }) {
  const month = summary.month;
  const [open, setOpen] = useState(false);
  // What you earn stays covered until you ask for it (the screen owns the
  // switch, so Received above follows it too).
  const amount = (value: number, code: string) => (shown ? money(value, code) : '••••');
  const [draft, setDraft] = useState({ label: 'Salary', amount: '', currency: 'INR', payDay: 1, category: 'Salary' });
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const currency = month?.currency ?? 'INR';
  const plan = summary.incomePlan.filter((entry) => entry.active);
  const planCategories = new Set(plan.map((entry) => entry.category));
  const sources = month?.incomeCategories ?? [];
  // Anything that is not one of your expected streams is extra money.
  const expected = sources.filter((source) => planCategories.has(source.category));
  const extra = sources.filter((source) => !planCategories.has(source.category));
  const extraTotal = extra.reduce((sum, source) => sum + source.amount, 0);
  const expectedTotal = plan.reduce((sum, entry) => sum + entry.amount, 0);
  const receivedExpected = expected.reduce((sum, source) => sum + source.amount, 0);

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        setOpen(false);
        setEditing(null);
        setDraft({ label: 'Salary', amount: '', currency, payDay: 1, category: 'Salary' });
      }
    });
  }

  return (
    <>
      <div className="fd-label-row">
        <FieldLabel>Money in</FieldLabel>
        <button className="fd-link" type="button" aria-pressed={shown} onClick={() => onShown(!shown)}>
          {shown ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />} {shown ? 'Hide amounts' : 'Show amounts'}
        </button>
      </div>

      {plan.length > 0 ? (
        <section className="fd-quiet">
          {plan.map((entry) => {
            const arrived = expected.find((source) => source.category === entry.category)?.amount ?? 0;
            return (
              <div className="fd-line" key={entry.id}>
                <span className="fd-two">
                  {entry.label}
                  <small>{amount(entry.amount, entry.currency)} · usually the {ordinal(entry.payDay)}</small>
                </span>
                <b className={arrived > 0 ? 'up' : 'empty'}>{arrived > 0 ? amount(arrived, currency) : 'not yet'}</b>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="fd-empty">Tell Orbis what you expect to earn and it can tell salary from extra money, and say when it has not arrived.</p>
      )}

      {extra.length > 0 && (
        <>
          <p className="fd-label">Extra money · {amount(extraTotal, currency)}</p>
          <section className="fd-quiet">
            {extra.map((source) => (
              <div className="fd-line" key={source.category}>
                <span>{source.category}</span>
                <b className="up">{amount(source.amount, currency)}</b>
              </div>
            ))}
          </section>
        </>
      )}

      {/* Only with a plan: without one this pair was this month's received and
          spent again, which the card above already states. */}
      {month && plan.length > 0 && (
        <div className="fd-pair">
          <div><span>In this month</span><b className="up">{amount(month.received, currency)}</b></div>
          <div><span>Against expected</span><b>{amount(expectedTotal, currency)}</b></div>
        </div>
      )}
      {plan.length > 0 && receivedExpected === 0 && (
        <p className="fd-note">Nothing has arrived against {plan.length === 1 ? plan[0].label.toLowerCase() : 'your expected income'} this month yet.</p>
      )}

      {!summary.incomePlanReady ? (
        <p className="fd-note">Apply the income plan migration in Supabase to set what you expect to earn.</p>
      ) : open ? (
        <form
          className="rt-form"
          onSubmit={(submit) => { submit.preventDefault(); run(() => safeAction(saveIncomePlanAction)({ ...draft, id: editing ?? undefined })); }}
        >
          <label className="fd-field">Name
            <input value={draft.label} onChange={(change) => setDraft({ ...draft, label: change.currentTarget.value })} placeholder="Salary" maxLength={60} required disabled={isPending} />
          </label>
          <div className="rt-form-row">
            <label className="fd-field">Amount
              <input value={draft.amount} onChange={(change) => setDraft({ ...draft, amount: change.currentTarget.value })} inputMode="decimal" placeholder="85000" required disabled={isPending} />
            </label>
            <label className="fd-field">Day of month
              <input type="number" min={1} max={31} value={draft.payDay} onChange={(change) => setDraft({ ...draft, payDay: Number(change.currentTarget.value) })} required disabled={isPending} />
            </label>
          </div>
          <label className="fd-field">Counts as
            <select value={draft.category} onChange={(change) => setDraft({ ...draft, category: change.currentTarget.value })} disabled={isPending}>
              {INCOME_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <div className="fd-act">
            <button type="submit" disabled={isPending || !draft.label.trim() || !draft.amount}>{editing ? 'Save changes' : 'Save'}</button>
            <button className="fd-link" type="button" onClick={() => { setOpen(false); setEditing(null); }} disabled={isPending}>Cancel</button>
            {editing && <button className="fd-link alert" type="button" disabled={isPending} onClick={() => { if (window.confirm('Remove this? What you already recorded is kept.')) run(() => safeAction(deleteIncomePlanAction)(editing)); }}><Trash2 size={13} aria-hidden="true" /> Remove</button>}
          </div>
        </form>
      ) : (
        <div className="fd-act">
          <button className="ghost" type="button" onClick={() => setOpen(true)}><Plus size={14} aria-hidden="true" /> {plan.length ? 'Add another' : 'Set what you earn'}</button>
          {plan.length === 1 && (
            <button className="fd-link" type="button" onClick={() => { const entry = plan[0]; setDraft({ label: entry.label, amount: String(entry.amount), currency: entry.currency, payDay: entry.payDay, category: entry.category }); setEditing(entry.id); setOpen(true); }}>Edit</button>
          )}
        </div>
      )}

      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </>
  );
}
