'use client';

import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { acceptPhoneTransactionAction, dismissPhoneTransactionAction, loadPhoneTransactionsAction } from '@/app/finance/phone-review-actions';
import { usePersonLocale } from '@/components/locale/person-locale';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance/manual';
import { reviewLine } from '@/lib/finance/phone-review-line';
import type { PhoneTransaction } from '@/lib/finance/phone-review';
import { safeAction } from '@/lib/client/safe-action';

type Busy = { signalId: string; action: 'add' | 'dismiss' } | null;

/**
 * Payments the phone read from notifications, waiting for a yes or no. Adding one
 * saves it as an ordinary transaction; "Not a payment" throws it away. Nothing is
 * drawn until there is something to review. The notification's own text is never shown.
 */
export function PhoneReview() {
  const loc = usePersonLocale();
  const [items, setItems] = useState<PhoneTransaction[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<{ signalId: string; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    safeAction(loadPhoneTransactionsAction, () => [])().then((rows) => {
      if (live) setItems(rows);
    });
    return () => { live = false; };
  }, []);

  if (!items.length) return null;

  async function run(item: PhoneTransaction, action: 'add' | 'dismiss') {
    if (busy) return;
    setBusy({ signalId: item.signalId, action });
    setFailure(null);
    const result = action === 'add'
      ? await safeAction(acceptPhoneTransactionAction)({ signalId: item.signalId, category: categories[item.signalId] ?? 'Other' })
      : await safeAction(dismissPhoneTransactionAction)(item.signalId);
    setBusy(null);
    if (result.success) setItems((current) => current.filter((row) => row.signalId !== item.signalId));
    else setFailure({ signalId: item.signalId, message: result.message });
  }

  return (
    <section className="pr" aria-labelledby="pr-title">
      <h2 className="mn-h" id="pr-title">From your phone, to review</h2>
      <ul className="pr-list">
        {items.map((item) => {
          const line = reviewLine(item, loc.locale, loc.currency, loc.timeZone);
          const working = busy?.signalId === item.signalId;
          const options: readonly string[] = item.direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
          const problem = failure?.signalId === item.signalId ? failure.message : null;
          return (
            <li className="pr-row" key={item.signalId}>
              <div className="pr-copy">
                <strong className="pr-title">{line.title}</strong>
                <span className="pr-meta">{line.meta}</span>
              </div>
              <div className="pr-controls">
                <select className="pr-select" aria-label={`Category for ${line.title}`} value={categories[item.signalId] ?? 'Other'} onChange={(event) => { const value = event.currentTarget.value; setCategories((current) => ({ ...current, [item.signalId]: value })); }} disabled={Boolean(busy)}>
                  {options.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <button className="pr-btn pr-add" type="button" onClick={() => run(item, 'add')} disabled={Boolean(busy)}>
                  {working && busy?.action === 'add' ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
                  Add to Money
                </button>
                <button className="pr-btn pr-skip" type="button" onClick={() => run(item, 'dismiss')} disabled={Boolean(busy)}>Not a payment</button>
              </div>
              {problem && <p className="pr-msg" role="alert">{problem}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
