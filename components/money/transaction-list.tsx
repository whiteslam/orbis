'use client';

import { useState, useTransition } from 'react';
import { Mail, PenLine, Trash2 } from 'lucide-react';
import { categoryStyle } from '@/components/money/category-style';
import { deleteManualTransactionAction } from '@/app/finance/actions';
import { paymentMethodLabel } from '@/lib/finance/manual';
import type { FinanceTransactionSummary } from '@/lib/finance/types';
import { safeAction } from '@/lib/client/safe-action';

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
}

/**
 * A ledger amount: always to the paisa, so the figures in a column line up,
 * with the fraction set quieter than the whole.
 */
export function LedgerAmount({ amount, currency, sign = '' }: Readonly<{ amount: number; currency: string; sign?: string }>) {
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(amount);
  } catch {
    return <>{sign}{money(amount, currency)}</>;
  }
  const cut = parts.findIndex((part) => part.type === 'decimal');
  const whole = (cut < 0 ? parts : parts.slice(0, cut)).map((part) => part.value).join('');
  const fraction = cut < 0 ? '' : parts.slice(cut).map((part) => part.value).join('');
  return <>{sign}{whole}{fraction && <span className="mn-paise">{fraction}</span>}</>;
}

// What a day cost: its expenses, when there are several and they share one currency.
function dayTotal(items: FinanceTransactionSummary[]) {
  const spent = items.filter((item) => item.direction === 'expense');
  // A day of one spend already says its total on the row.
  if (spent.length < 2 || new Set(spent.map((item) => item.currency)).size > 1) return null;
  return { amount: spent.reduce((sum, item) => sum + item.amount, 0), currency: spent[0].currency };
}

const dayKey = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
const transactionTime = (value: string) => new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));

function dayHeading(key: string) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function TransactionList({ transactions }: Readonly<{ transactions: FinanceTransactionSummary[] }>) {
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(transaction: FinanceTransactionSummary) {
    if (!window.confirm(`Delete this ${transaction.direction} of ${money(transaction.amount, transaction.currency)}?`)) return;
    setMessage(null);
    setDeletingId(transaction.id);
    startTransition(async () => {
      const result = await safeAction(deleteManualTransactionAction)(transaction.id);
      if (!result.success) setMessage(result.message);
      setDeletingId(null);
    });
  }

  const days = new Map<string, FinanceTransactionSummary[]>();
  for (const transaction of transactions) {
    const key = dayKey(transaction.occurredAt);
    days.set(key, [...(days.get(key) ?? []), transaction]);
  }

  return (
    <div className="finance-transactions mn-days">
      {[...days].map(([key, items]) => {
        const total = dayTotal(items);
        return (
          <section key={key} className="transaction-day">
            <h4 className="mn-day-head">
              <span>{dayHeading(key)}</span>
              {total && <span className="mn-day-total"><span className="sr-only">Spent </span><LedgerAmount amount={total.amount} currency={total.currency} /></span>}
            </h4>
            <div className="mn-rows">
              {items.map((transaction) => {
                const style = categoryStyle(transaction.category);
                const Icon = style.icon;
                const details = [transaction.merchant ? transaction.category : null, paymentMethodLabel(transaction.paymentMethod)].filter(Boolean).join(', ');
                const income = transaction.direction === 'income';
                return (
                  <div className="finance-transaction" key={transaction.id}>
                    <span className="category-tile" style={{ background: style.color }} aria-hidden="true"><Icon size={15} strokeWidth={2.2} /></span>
                    <div className="finance-transaction-copy">
                      <strong>{transaction.merchant || transaction.category || 'Transaction'}</strong>
                      <small className="finance-transaction-meta">
                        {transaction.source === 'manual' ? <PenLine size={10} aria-label="Added manually" /> : <Mail size={10} aria-label="From Gmail" />}
                        {[transactionTime(transaction.occurredAt), details].filter(Boolean).join(' · ')}
                      </small>
                      {transaction.note && <p className="finance-transaction-note">{transaction.note}</p>}
                    </div>
                    <div className="finance-transaction-side">
                      <strong className={income ? 'income' : ''}><LedgerAmount amount={transaction.amount} currency={transaction.currency} sign={income ? '+' : ''} /></strong>
                      {transaction.source === 'manual' && (
                        <button type="button" className="finance-transaction-delete" onClick={() => remove(transaction)} disabled={isPending} aria-label="Delete transaction">
                          <Trash2 size={14} />{deletingId === transaction.id ? 'Deleting…' : ''}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {message && <output className="gmail-review-message">{message}</output>}
    </div>
  );
}
