'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, PenLine, Trash2 } from 'lucide-react';
import { categoryStyle } from '@/components/finance/category-style';
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

const dayKey = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
const transactionTime = (value: string) => new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));

function dayHeading(key: string) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function TransactionList({ transactions }: { transactions: FinanceTransactionSummary[] }) {
  const router = useRouter();
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
      router.refresh();
    });
  }

  const days = new Map<string, FinanceTransactionSummary[]>();
  for (const transaction of transactions) {
    const key = dayKey(transaction.occurredAt);
    days.set(key, [...(days.get(key) ?? []), transaction]);
  }

  return (
    <div className="finance-transactions">
      {[...days].map(([key, items]) => (
        <section key={key} className="transaction-day">
          <h4>{dayHeading(key)}</h4>
          <div className="apple-list">
            {items.map((transaction) => {
              const style = categoryStyle(transaction.category);
              const Icon = style.icon;
              const details = [transaction.merchant ? transaction.category : null, paymentMethodLabel(transaction.paymentMethod)].filter(Boolean).join(', ');
              return (
                <div className="finance-transaction" key={transaction.id}>
                  <span className="category-tile" style={{ background: style.color }} aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>
                  <div className="finance-transaction-copy">
                    <strong>{transaction.merchant || transaction.category || 'Transaction'}</strong>
                    <small className="finance-transaction-meta">
                      {transaction.source === 'manual' ? <PenLine size={10} aria-label="Added manually" /> : <Mail size={10} aria-label="From Gmail" />}
                      {[transactionTime(transaction.occurredAt), details].filter(Boolean).join(' · ')}
                    </small>
                    {transaction.note && <p className="finance-transaction-note">{transaction.note}</p>}
                  </div>
                  <div className="finance-transaction-side">
                    <strong className={transaction.direction === 'income' ? 'income' : ''}>{transaction.direction === 'income' ? '+' : ''}{money(transaction.amount, transaction.currency)}</strong>
                    {transaction.source === 'manual' && (
                      <button type="button" className="finance-transaction-delete" onClick={() => remove(transaction)} disabled={isPending} aria-label="Delete transaction">
                        <Trash2 size={12} />{deletingId === transaction.id ? 'Deleting…' : ''}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {message && <p className="gmail-review-message" role="status">{message}</p>}
    </div>
  );
}
