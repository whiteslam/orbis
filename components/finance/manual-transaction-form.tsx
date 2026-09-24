'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, PenLine, Plus, X } from 'lucide-react';
import { addManualTransactionAction } from '@/app/finance/actions';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MANUAL_NOTE_MAX_LENGTH, PAYMENT_METHODS } from '@/lib/finance/manual';
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

export function ManualTransactionForm({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [category, setCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories: readonly string[] = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const today = nowInIndia().date;

  function openForm() {
    const now = nowInIndia();
    setDate(now.date);
    setTime(now.time);
    setMessage(null);
    setOpen(true);
  }

  function changeDirection(next: 'expense' | 'income') {
    setDirection(next);
    setCategory('');
  }

  function reset() {
    const now = nowInIndia();
    setAmount('');
    setCategory('');
    setMerchant('');
    setNote('');
    setDate(now.date);
    setTime(now.time);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) {
      setMessage({ text: 'Choose a category.', success: false });
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
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        reset();
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <section className="manual-entry-closed">
        <div className="manual-entry-icon"><PenLine size={18} aria-hidden="true" /></div>
        <div>
          <strong>Add manually</strong>
          <p>Log cash spends, UPI payments, or anything Gmail missed.</p>
        </div>
        <button className="finance-button primary" type="button" onClick={openForm} disabled={disabled}><Plus size={14} />Add</button>
        {message?.success && <p className="gmail-review-message success manual-entry-closed-message" role="status">{message.text}</p>}
      </section>
    );
  }

  const isIncome = direction === 'income';

  return (
    <form className="manual-entry" onSubmit={submit} aria-labelledby="manual-entry-title">
      <div className="manual-entry-head">
        <div><small>MANUAL ENTRY</small><h3 id="manual-entry-title">{isIncome ? 'Add income' : 'Add expense'}</h3></div>
        <button className="manual-entry-close" type="button" onClick={() => setOpen(false)} aria-label="Close manual entry"><X size={16} /></button>
      </div>

      <div className="manual-entry-toggle" role="radiogroup" aria-label="Transaction type">
        {(['expense', 'income'] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={direction === value} className={direction === value ? 'active' : ''} onClick={() => changeDirection(value)} disabled={isPending}>
            {value === 'expense' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>

      <div className="manual-entry-amount">
        <label htmlFor="manual-amount">Amount</label>
        <div>
          <select aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.currentTarget.value)} disabled={isPending}>
            {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <input id="manual-amount" inputMode="decimal" type="number" min="0.01" step="0.01" max="100000000" placeholder="0.00" required value={amount} onChange={(event) => setAmount(event.currentTarget.value)} disabled={isPending} />
        </div>
      </div>

      <fieldset className="manual-entry-group">
        <legend>Category</legend>
        <div className="manual-entry-chips">
          {categories.map((value) => (
            <button key={value} type="button" aria-pressed={category === value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)} disabled={isPending}>{value}</button>
          ))}
        </div>
      </fieldset>

      <div className="manual-entry-fields">
        <label className="manual-entry-wide">{isIncome ? 'Received from' : 'Paid to'}
          <input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.currentTarget.value)} disabled={isPending} placeholder={isIncome ? 'Employer, client, or person (optional)' : 'Merchant, shop, or person (optional)'} />
        </label>
        <label>Date<input type="date" required max={today} min="2000-01-01" value={date} onChange={(event) => setDate(event.currentTarget.value)} disabled={isPending} /></label>
        <label>Time<input type="time" value={time} onChange={(event) => setTime(event.currentTarget.value)} disabled={isPending} /></label>
      </div>

      <fieldset className="manual-entry-group">
        <legend>{isIncome ? 'Received via' : 'Paid with'}</legend>
        <div className="manual-entry-chips">
          {PAYMENT_METHODS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={paymentMethod === value} className={paymentMethod === value ? 'active' : ''} onClick={() => setPaymentMethod(paymentMethod === value ? '' : value)} disabled={isPending}>{label}</button>
          ))}
        </div>
      </fieldset>

      <label className="manual-entry-note">Note
        <textarea rows={2} maxLength={MANUAL_NOTE_MAX_LENGTH} value={note} onChange={(event) => setNote(event.currentTarget.value)} disabled={isPending} placeholder="What was it for? (optional)" />
        <small>{note.length}/{MANUAL_NOTE_MAX_LENGTH}</small>
      </label>

      <div className="gmail-review-actions">
        <button className="finance-button primary" type="submit" disabled={isPending || !amount || !date}>
          {isPending ? <><LoaderCircle className="workbook-spinner" size={14} />Saving…</> : <><Check size={14} />{isIncome ? 'Save income' : 'Save expense'}</>}
        </button>
        <button className="finance-button secondary" type="button" onClick={() => setOpen(false)} disabled={isPending}>Cancel</button>
      </div>
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </form>
  );
}
