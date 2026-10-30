'use client';

import { useState, useTransition } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { addManualTransactionAction } from '@/app/finance/actions';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, INVESTMENT_CATEGORIES, MANUAL_NOTE_MAX_LENGTH, PAYMENT_METHODS, isInvestmentCategory } from '@/lib/finance/manual';
import { FieldSubHead } from '@/components/field/field';
import { CurrencyCard } from '@/components/money/currency-card';
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

type Kind = 'expense' | 'income' | 'investment';

// What each kind of entry offers and calls things.
const KIND_COPY: Record<Kind, { label: string; categories: readonly string[]; counterparty: string; placeholder: string }> = {
  expense: { label: 'Expense', categories: EXPENSE_CATEGORIES, counterparty: 'Paid to', placeholder: 'Merchant, shop, or person (optional)' },
  income: { label: 'Income', categories: INCOME_CATEGORIES, counterparty: 'Received from', placeholder: 'Employer, client, or person (optional)' },
  investment: { label: 'Investment', categories: INVESTMENT_CATEGORIES, counterparty: 'Invested with', placeholder: 'Bank, fund house, or broker (optional)' },
};

/** The manual entry view. `onClose` leaves it; `onSaved` leaves it after a save, with the result to show. */
export function ManualTransactionForm({ onClose, onSaved, initialCategory }: Readonly<{ onClose: () => void; onSaved: (message: string) => void; initialCategory?: string }>) {
  const [direction, setDirection] = useState<Kind>(() => isInvestmentCategory(initialCategory) ? 'investment' : 'expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [category, setCategory] = useState(() => initialCategory && ([...EXPENSE_CATEGORIES, ...INVESTMENT_CATEGORIES] as readonly string[]).includes(initialCategory) ? initialCategory : '');
  const [merchant, setMerchant] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [date, setDate] = useState(() => nowInIndia().date);
  const [time, setTime] = useState(() => nowInIndia().time);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const copy = KIND_COPY[direction];
  const categories = copy.categories;
  const today = nowInIndia().date;
  const isIncome = direction === 'income';
  const isInvestment = direction === 'investment';
  const noun = direction;

  function changeDirection(next: Kind) {
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
      <FieldSubHead crumb="Spending · manual entry" title={`Add ${noun}`} lead="Cash, UPI, or anything Gmail never saw." onClose={onClose} backLabel="Close manual entry" />

      <div className="mn mn-entry">
      <form className="fd-form mn-sheet" onSubmit={submit}>
        <div className="fd-seg" role="radiogroup" aria-label="Transaction type">
          {(['expense', 'income', 'investment'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={direction === value} onClick={() => changeDirection(value)} disabled={isPending}>
              {KIND_COPY[value].label}
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

        {isInvestment && <p className="fd-hint">Kept out of what you spent, and listed under Investments.</p>}

        <label className="fd-field wide">{copy.counterparty}
          <input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.currentTarget.value)} disabled={isPending} placeholder={copy.placeholder} />
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

        <label className="fd-field wide">Note<textarea rows={2} maxLength={MANUAL_NOTE_MAX_LENGTH} value={note} onChange={(event) => setNote(event.currentTarget.value)} disabled={isPending} placeholder="What was it for? (optional)" />
        </label>
        <p className="fd-count">{note.length}/{MANUAL_NOTE_MAX_LENGTH}</p>

        {message && <p className="fd-msg bad" role="alert">{message}</p>}
        <div className="fd-act">
          <button type="submit" disabled={isPending || !amount || !date}>
            {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" />Saving…</> : <><Check size={14} strokeWidth={2.4} aria-hidden="true" />{`Save ${noun}`}</>}
          </button>
          <button className="ghost" type="button" onClick={onClose} disabled={isPending}>Cancel</button>
        </div>
      </form>

      <div className="mn-foot">
        <p className="fd-note">Saved entries appear in Transactions straight away.</p>
        <CurrencyCard />
      </div>
      </div>
    </>
  );
}
