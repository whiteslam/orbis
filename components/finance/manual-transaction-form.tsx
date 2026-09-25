'use client';

import { useState, useTransition } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { addManualTransactionAction } from '@/app/finance/actions';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MANUAL_NOTE_MAX_LENGTH, PAYMENT_METHODS } from '@/lib/finance/manual';
import { FieldSubHead } from '@/components/field/field';
import { CurrencyCard } from '@/components/finance/currency-card';
import { safeAction } from '@/lib/client/safe-action';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

// Orbis treats every finance date as India time (see getFinanceSummary).
function nowInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/** The manual entry view. `onClose` leaves it; `onSaved` leaves it after a save, with the result to show. */
export function ManualTransactionForm({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [category, setCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [date, setDate] = useState(() => nowInIndia().date);
  const [time, setTime] = useState(() => nowInIndia().time);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories: readonly string[] = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const today = nowInIndia().date;
  const isIncome = direction === 'income';

  function changeDirection(next: 'expense' | 'income') {
    setDirection(next);
    setCategory('');
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) {
      setMessage('Choose a category.');
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(addManualTransactionAction)({
        amount,
        currency,
        direction,
        category,
        merchant,
        paymentMethod,
        occurredAt: `${date}T${time || '12:00'}:00+05:30`,
        note,
      });
      if (result.success) onSaved(result.message);
      else setMessage(result.message);
    });
  }

  return (
    <>
      <FieldSubHead crumb="Expense · manual entry" title={isIncome ? 'Add income' : 'Add expense'} lead="Cash, UPI, or anything Gmail never saw." onClose={onClose} backLabel="Close manual entry" />

      <form className="fd-form" onSubmit={submit}>
        <div className="fd-seg" role="radiogroup" aria-label="Transaction type">
          {(['expense', 'income'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={direction === value} onClick={() => changeDirection(value)} disabled={isPending}>
              {value === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>

        <label className="fd-label" htmlFor="manual-amount">Amount</label>
        <div className="fd-amount">
          <select aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.currentTarget.value)} disabled={isPending}>
            {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <input id="manual-amount" inputMode="decimal" type="number" min="0.01" step="0.01" max="100000000" placeholder="0.00" required value={amount} onChange={(event) => setAmount(event.currentTarget.value)} disabled={isPending} />
        </div>

        <fieldset className="fd-chips">
          <legend className="fd-label">Category</legend>
          <div>
            {categories.map((value) => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)} disabled={isPending}>{value}</button>
            ))}
          </div>
        </fieldset>

        <label className="fd-field wide">{isIncome ? 'Received from' : 'Paid to'}
          <input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.currentTarget.value)} disabled={isPending} placeholder={isIncome ? 'Employer, client, or person (optional)' : 'Merchant, shop, or person (optional)'} />
        </label>
        <div className="fd-grid">
          <label className="fd-field">Date<input type="date" required max={today} min="2000-01-01" value={date} onChange={(event) => setDate(event.currentTarget.value)} disabled={isPending} /></label>
          <label className="fd-field">Time<input type="time" value={time} onChange={(event) => setTime(event.currentTarget.value)} disabled={isPending} /></label>
        </div>

        <fieldset className="fd-chips">
          <legend className="fd-label">{isIncome ? 'Received via' : 'Paid with'}</legend>
          <div>
            {PAYMENT_METHODS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={paymentMethod === value} onClick={() => setPaymentMethod(paymentMethod === value ? '' : value)} disabled={isPending}>{label}</button>
            ))}
          </div>
        </fieldset>

        <label className="fd-field wide">Note
          <textarea rows={2} maxLength={MANUAL_NOTE_MAX_LENGTH} value={note} onChange={(event) => setNote(event.currentTarget.value)} disabled={isPending} placeholder="What was it for? (optional)" />
        </label>
        <p className="fd-count">{note.length}/{MANUAL_NOTE_MAX_LENGTH}</p>

        {message && <p className="fd-msg bad" role="alert">{message}</p>}
        <div className="fd-act">
          <button type="submit" disabled={isPending || !amount || !date}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" />Saving…</> : <><Check size={14} strokeWidth={2.4} aria-hidden="true" />{isIncome ? 'Save income' : 'Save expense'}</>}
          </button>
          <button className="ghost" type="button" onClick={onClose} disabled={isPending}>Cancel</button>
        </div>
      </form>

      <CurrencyCard />
    </>
  );
}
