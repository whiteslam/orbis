'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { deleteInvestmentHoldingAction, saveInvestmentHoldingAction } from '@/app/invest/actions';
import type { InvestmentSummary } from '@/lib/invest/types';

const assetTypes = [
  ['stock', 'Stock'], ['fund', 'Mutual fund'], ['etf', 'ETF'], ['crypto', 'Crypto'], ['cash', 'Cash'], ['other', 'Other'],
] as const;

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString('en-IN')}`; }
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function InvestmentHoldings({ summary }: { summary: InvestmentSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function onSave(event: React.FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    run(() => saveInvestmentHoldingAction({
      id,
      name: String(fields.get('name') ?? ''),
      assetType: String(fields.get('assetType') ?? ''),
      quantity: String(fields.get('quantity') ?? ''),
      valuePerUnit: String(fields.get('valuePerUnit') ?? ''),
      currency: String(fields.get('currency') ?? 'INR'),
      valueAsOf: String(fields.get('valueAsOf') ?? ''),
    }));
  }

  if (!summary.databaseReady) return <div className="empty-state"><strong>Investment tracking is not set up</strong><p>Apply the Investment holdings migration in Supabase, then refresh.</p></div>;
  if (summary.loadError) return <div className="empty-state"><strong>Investment data could not be loaded</strong><p>Refresh the app and try again.</p></div>;

  return <>
    {message && <p className={`finance-notice ${message.success ? 'success' : 'error'}`} role="status">{message.text}</p>}
    <div className="investment-note"><strong>Manual holdings</strong><p>Values are entered by you and are not live market prices or investment advice.</p></div>
    <form className="personal-form stack-card" onSubmit={(event) => onSave(event)}>
      <strong><Plus size={15} /> Add a holding</strong>
      <label>Name<input name="name" maxLength={100} required placeholder="Index fund or stock name" /></label>
      <div className="form-row"><label>Type<select name="assetType" defaultValue="fund">{assetTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Currency<input name="currency" maxLength={3} defaultValue="INR" required /></label></div>
      <div className="form-row"><label>Units<input name="quantity" type="number" min="0.000001" step="0.000001" required placeholder="10" /></label><label>Value per unit<input name="valuePerUnit" type="number" min="0" step="0.0001" required placeholder="125.50" /></label></div>
      <label>Value date<input name="valueAsOf" type="date" defaultValue={localToday()} required /></label>
      <button className="finance-button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save holding'}</button>
    </form>
    {summary.holdings.length ? <div className="investment-list">{summary.holdings.map((holding) => <article className="stack-card investment-holding" key={holding.id}>
      <form onSubmit={(event) => onSave(event, holding.id)}>
        <div className="investment-holding-head"><strong>{holding.name}</strong><button type="button" className="workbook-icon-button" aria-label={`Remove ${holding.name}`} disabled={pending} onClick={() => { if (window.confirm(`Remove ${holding.name} from your holdings?`)) run(() => deleteInvestmentHoldingAction(holding.id)); }}><Trash2 size={15} /></button></div>
        <small>{assetTypes.find(([value]) => value === holding.assetType)?.[1] ?? 'Other'} · {holding.quantity.toLocaleString()} units · {money(holding.quantity * holding.valuePerUnit, holding.currency)} as of {holding.valueAsOf}</small>
        <div className="form-row"><label>Name<input name="name" maxLength={100} defaultValue={holding.name} required /></label><label>Type<select name="assetType" defaultValue={holding.assetType}>{assetTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
        <div className="form-row"><label>Units<input name="quantity" type="number" min="0.000001" step="0.000001" defaultValue={holding.quantity} required /></label><label>Value per unit<input name="valuePerUnit" type="number" min="0" step="0.0001" defaultValue={holding.valuePerUnit} required /></label></div>
        <div className="form-row"><label>Currency<input name="currency" maxLength={3} defaultValue={holding.currency} required /></label><label>Value date<input name="valueAsOf" type="date" defaultValue={holding.valueAsOf} required /></label></div>
        <button className="finance-button secondary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Update holding'}</button>
      </form>
    </article>)}</div> : <div className="empty-state"><strong>No holdings yet</strong><p>Add the investments you want to track. Orbis will show the total from your entries.</p></div>}
  </>;
}
