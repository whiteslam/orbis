'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { deleteInvestmentHoldingAction, saveInvestmentHoldingAction } from '@/app/invest/actions';
import type { InvestmentHolding, InvestmentSummary, LivePrice } from '@/lib/invest/types';
import { safeAction } from '@/lib/client/safe-action';

const assetTypes = [
  ['stock', 'Stock'], ['fund', 'Mutual fund'], ['etf', 'ETF'], ['crypto', 'Crypto'], ['cash', 'Cash'], ['other', 'Other'],
] as const;

const marketSources = [
  ['', 'No live price'],
  ['alpha_vantage', 'Stock (BSE / global)'],
  ['amfi', 'Mutual fund or ETF (ISIN)'],
  ['coingecko', 'Crypto (CoinGecko)'],
] as const;

const symbolHint: Record<string, string> = {
  alpha_vantage: 'RELIANCE or AAPL',
  amfi: 'ISIN, e.g. INF179K01VQ6',
  coingecko: 'bitcoin, ethereum…',
};

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString('en-IN')}`; }
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function MarketFields({ holding }: { holding?: InvestmentHolding }) {
  const [source, setSource] = useState<string>(holding?.marketSource ?? '');
  return (
    <div className="form-row">
      <label>Live price<select name="marketSource" value={source} onChange={(event) => setSource(event.currentTarget.value)}>{marketSources.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Symbol<input name="marketSymbol" maxLength={40} defaultValue={holding?.marketSymbol ?? ''} disabled={!source} required={Boolean(source)} placeholder={symbolHint[source] ?? 'Not needed'} /></label>
    </div>
  );
}

function liveValueLine(holding: InvestmentHolding, price: LivePrice | undefined) {
  if (!price) return null;
  const currency = price.source === 'amfi' || price.source === 'coingecko' ? 'INR' : holding.currency;
  const label = price.source === 'amfi' ? 'NAV' : 'Live';
  const change = price.changePercent === null ? '' : ` · ${price.changePercent >= 0 ? '+' : ''}${price.changePercent.toFixed(2)}% today`;
  return `${label} ${money(price.price, currency)} → ${money(holding.quantity * price.price, currency)}${change}${price.stale ? ' · last saved' : ''}`;
}

export function InvestmentHoldings({ summary, livePrices = {} }: { summary: InvestmentSummary; livePrices?: Record<string, LivePrice> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);

  function run(action: () => Promise<{ success: boolean; message: string }>, onSuccess?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function onSave(event: React.FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    run(() => safeAction(saveInvestmentHoldingAction)({
      id,
      name: String(fields.get('name') ?? ''),
      assetType: String(fields.get('assetType') ?? ''),
      quantity: String(fields.get('quantity') ?? ''),
      valuePerUnit: String(fields.get('valuePerUnit') ?? ''),
      currency: String(fields.get('currency') ?? 'INR'),
      valueAsOf: String(fields.get('valueAsOf') ?? ''),
      marketSource: String(fields.get('marketSource') ?? ''),
      marketSymbol: String(fields.get('marketSymbol') ?? ''),
    }), id ? undefined : () => form.reset());
  }

  if (!summary.databaseReady) return <div className="empty-state"><strong>Investment tracking is not set up</strong><p>Apply the Investment holdings migration in Supabase, then refresh.</p></div>;
  if (summary.loadError) return <div className="empty-state"><strong>Investment data could not be loaded</strong><p>Refresh the app and try again.</p></div>;

  return <>
    {message && <p className={`finance-notice ${message.success ? 'success' : 'error'}`} role="status">{message.text}</p>}
    <div className="investment-note"><strong>Manual holdings</strong><p>Add what you own outside Groww. Link a symbol to get a live price; otherwise Orbis uses the value you enter.</p></div>
    <form className="personal-form stack-card" onSubmit={(event) => onSave(event)}>
      <strong><Plus size={15} /> Add a holding</strong>
      <label>Name<input name="name" maxLength={100} required placeholder="Index fund or stock name" /></label>
      <div className="form-row"><label>Type<select name="assetType" defaultValue="fund">{assetTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Currency<input name="currency" maxLength={3} defaultValue="INR" required /></label></div>
      <div className="form-row"><label>Units<input name="quantity" type="number" min="0.000001" step="0.000001" required placeholder="10" /></label><label>Value per unit<input name="valuePerUnit" type="number" min="0" step="0.0001" required placeholder="125.50" /></label></div>
      <MarketFields />
      <label>Value date<input name="valueAsOf" type="date" defaultValue={localToday()} required /></label>
      <button className="finance-button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save holding'}</button>
    </form>
    {summary.holdings.length ? <div className="investment-list">{summary.holdings.map((holding) => {
      const live = liveValueLine(holding, livePrices[holding.id]);
      return <article className="stack-card investment-holding" key={holding.id}>
        <form onSubmit={(event) => onSave(event, holding.id)}>
          <div className="investment-holding-head"><strong>{holding.name}</strong><button type="button" className="workbook-icon-button" aria-label={`Remove ${holding.name}`} disabled={pending} onClick={() => { if (window.confirm(`Remove ${holding.name} from your holdings?`)) run(() => safeAction(deleteInvestmentHoldingAction)(holding.id)); }}><Trash2 size={15} /></button></div>
          <small>{assetTypes.find(([value]) => value === holding.assetType)?.[1] ?? 'Other'} · {holding.quantity.toLocaleString()} units · {money(holding.quantity * holding.valuePerUnit, holding.currency)} as of {holding.valueAsOf}</small>
          {live && <small className="groww-price">{live}</small>}
          {!live && holding.marketSymbol && <small className="groww-price missing">No live price for {holding.marketSymbol} right now</small>}
          <div className="form-row"><label>Name<input name="name" maxLength={100} defaultValue={holding.name} required /></label><label>Type<select name="assetType" defaultValue={holding.assetType}>{assetTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <div className="form-row"><label>Units<input name="quantity" type="number" min="0.000001" step="0.000001" defaultValue={holding.quantity} required /></label><label>Value per unit<input name="valuePerUnit" type="number" min="0" step="0.0001" defaultValue={holding.valuePerUnit} required /></label></div>
          <MarketFields holding={holding} />
          <div className="form-row"><label>Currency<input name="currency" maxLength={3} defaultValue={holding.currency} required /></label><label>Value date<input name="valueAsOf" type="date" defaultValue={holding.valueAsOf} required /></label></div>
          <button className="finance-button secondary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Update holding'}</button>
        </form>
      </article>;
    })}</div> : <div className="empty-state"><strong>No holdings yet</strong><p>Add the investments you want to track. Orbis will show the total from your entries.</p></div>}
  </>;
}
