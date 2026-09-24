'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { connectBrokerAction, disconnectBrokerAction } from '@/app/invest/actions';
import type { BrokerMeta } from '@/lib/invest/brokers';
import type { BrokerPortfolio, PriceSource } from '@/lib/invest/types';
import { inr, signedInr } from '@/components/invest/format';
import { safeAction } from '@/lib/client/safe-action';

const SOURCE_LABEL: Record<PriceSource, string> = { groww: 'LTP', amfi: 'NAV', alpha_vantage: 'BSE', coingecko: 'Price' };

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: value.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(date);
}

function syncedAt(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

export function BrokerConnectForm({ meta, reconnect, setupMessage, onConnected }: { meta: BrokerMeta; reconnect: boolean; setupMessage?: string; onConnected: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(connectBrokerAction)({ broker: meta.id, apiKey, apiSecret });
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        setApiKey('');
        setApiSecret('');
        onConnected();
      }
    });
  }

  if (setupMessage) return <p className="finance-notice error">{setupMessage}</p>;

  return (
    <form className="groww-connect" onSubmit={submit}>
      <p className="groww-connect-intro">{reconnect ? `${meta.name} stopped accepting the saved key. Paste a fresh key and secret to sync again.` : `Link your ${meta.name} account to sync your ${meta.covers} automatically.`}</p>
      <ol className="groww-steps">
        <li>Open <a href={meta.keysUrl} target="_blank" rel="noreferrer">{meta.keysLabel} <ExternalLink size={10} /></a> and generate a key.</li>
        <li>Paste the <b>{meta.fields.key.toLowerCase()}</b> and <b>{meta.fields.secret.replace(/^API /i, '').toLowerCase()}</b> below.</li>
      </ol>
      <label>{meta.fields.key}<textarea value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} rows={2} required autoComplete="off" spellCheck={false} placeholder={meta.fields.keyPlaceholder} disabled={isPending} /></label>
      <label>{meta.fields.secret}<input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.currentTarget.value)} required autoComplete="off" placeholder="••••••••••" disabled={isPending} /></label>
      <button className="finance-button primary" type="submit" disabled={isPending || !apiKey.trim() || !apiSecret.trim()}>
        {isPending ? <><LoaderCircle className="workbook-spinner" size={14} /> Checking with {meta.name}…</> : <><KeyRound size={14} /> {reconnect ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}</>}
      </button>
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
      <p className="groww-privacy"><ShieldCheck size={12} aria-hidden="true" /> Read-only. Orbis only reads holdings and can’t place orders. Your key and secret are encrypted and never shown again.</p>
    </form>
  );
}

/**
 * One connected account: its state, its holdings, and the controls for the
 * connection itself. Every provider renders through this, so the screen grows
 * by adding an entry to the broker registry rather than another component.
 */
export function BrokerCard({ meta, portfolio, isLoading, onRefresh }: { meta: BrokerMeta; portfolio: BrokerPortfolio | null; isLoading: boolean; onRefresh: () => void }) {
  const [notice, setNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [isDisconnecting, startDisconnect] = useTransition();
  const holdings = portfolio?.holdings ?? [];
  const connection = portfolio?.connection ?? null;
  const connected = Boolean(connection) && portfolio?.state !== 'not_connected';
  const needsReconnect = connection?.status === 'reconnect_required';

  function disconnect() {
    if (!window.confirm(`Disconnect ${meta.name}? Orbis will delete the saved key and secret.`)) return;
    setNotice(null);
    startDisconnect(async () => {
      const result = await safeAction(disconnectBrokerAction)(meta.id);
      setNotice({ text: result.message, success: result.success });
      if (result.success) onRefresh();
    });
  }

  return (
    <section className="groww-card" aria-labelledby={`broker-${meta.id}-title`}>
      <div className="groww-head">
        <div className="groww-icon"><Image src={meta.logo} alt={meta.name} width={24} height={24} /></div>
        <div>
          <small className={needsReconnect ? 'groww-status warn' : connected ? 'groww-status' : 'groww-status off'}>{needsReconnect ? 'NEEDS RECONNECT' : connected ? 'CONNECTED · READ-ONLY' : 'NOT CONNECTED'}</small>
          <h3 id={`broker-${meta.id}-title`}>{meta.name} holdings</h3>
        </div>
        {connected && (
          <button className="groww-refresh" type="button" onClick={onRefresh} disabled={isLoading} aria-label={`Sync ${meta.name} holdings`}>
            {isLoading ? <LoaderCircle className="workbook-spinner" size={15} /> : <RefreshCw size={15} />}
          </button>
        )}
      </div>

      {!portfolio && <p className="groww-muted">Checking your {meta.name} connection…</p>}
      {notice && <p className={`finance-notice ${notice.success ? 'success' : 'error'}`} role="status">{notice.text}</p>}
      {portfolio?.state === 'not_connected' && <BrokerConnectForm meta={meta} reconnect={false} setupMessage={portfolio.setupRequired ? portfolio.message : undefined} onConnected={onRefresh} />}
      {portfolio?.state === 'error' && <p className="finance-notice error">{portfolio.message}</p>}
      {portfolio?.state === 'error' && needsReconnect && connection?.source === 'account' && <BrokerConnectForm meta={meta} reconnect onConnected={onRefresh} />}

      {portfolio?.state === 'ok' && (
        <>
          {holdings.length ? (
            <div className="groww-list">
              {holdings.map((holding) => {
                const cost = holding.quantity * holding.averagePrice;
                const value = holding.lastPrice === null ? null : holding.quantity * holding.lastPrice;
                return (
                  <div className="groww-row" key={holding.isin ?? holding.symbol}>
                    <div>
                      <strong>{holding.symbol}</strong>
                      <small>{holding.quantity.toLocaleString('en-IN')} shares · avg {inr(holding.averagePrice)}</small>
                      {holding.lastPrice !== null && holding.priceSource
                        ? <small className="groww-price">{SOURCE_LABEL[holding.priceSource]} {inr(holding.lastPrice)}{holding.priceAsOf ? ` · ${shortDate(holding.priceAsOf)}` : ''}{holding.priceStale ? ' · last saved' : ''}</small>
                        : <small className="groww-price missing">Price unavailable</small>}
                    </div>
                    <div className="groww-row-value">
                      <strong>{inr(value ?? cost)}</strong>
                      {value !== null ? <small className={value - cost >= 0 ? 'up' : 'down'}>{signedInr(value - cost)}</small> : <small>invested</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="groww-muted">No {meta.covers} in this {meta.name} account.</p>}

          <p className="groww-muted">
            {meta.priceNote}
            {!portfolio.livePrices && ' Holdings without a price count at the amount invested.'}
            {meta.gapNote ? ` ${meta.gapNote}` : ''}
            {portfolio.fetchedAt && ` Synced ${syncedAt(portfolio.fetchedAt)}.`}
          </p>
        </>
      )}

      {connected && connection?.source === 'account' && (
        <div className="groww-actions">
          <button className="finance-button secondary" type="button" onClick={onRefresh} disabled={isLoading || isDisconnecting}><RefreshCw size={13} /> {isLoading ? 'Syncing…' : 'Sync now'}</button>
          <button className="finance-button secondary groww-disconnect" type="button" onClick={disconnect} disabled={isLoading || isDisconnecting}><Unplug size={13} /> {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
        </div>
      )}
      {connected && connection?.source === 'server' && <p className="groww-muted">Connected with the server’s {meta.name} keys.</p>}
    </section>
  );
}
