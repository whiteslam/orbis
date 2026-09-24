'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { connectGrowwAction, disconnectGrowwAction } from '@/app/invest/actions';
import type { GrowwPortfolio as GrowwPortfolioData } from '@/lib/invest/types';
import { inr, signedInr } from '@/components/invest/format';

const SOURCE_LABEL = { groww: 'LTP', amfi: 'NAV', alpha_vantage: 'BSE', coingecko: 'Price' } as const;

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: value.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(date);
}

function syncedAt(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

export function GrowwConnectForm({ reconnect, setupMessage, onConnected }: { reconnect: boolean; setupMessage?: string; onConnected: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await connectGrowwAction({ apiKey, apiSecret });
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
      <p className="groww-connect-intro">{reconnect ? 'Groww stopped accepting the saved key. Paste a fresh key and secret to sync again.' : 'Link your Groww account to sync your stocks and ETFs automatically.'}</p>
      <ol className="groww-steps">
        <li>Open <a href="https://groww.in/trade-api/api-keys" target="_blank" rel="noreferrer">Groww → Trade API keys <ExternalLink size={10} /></a> and generate a key.</li>
        <li>Paste the <b>API key</b> and <b>secret</b> below.</li>
      </ol>
      <label>API key<textarea value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} rows={2} required autoComplete="off" spellCheck={false} placeholder="eyJraWQiOi…" disabled={isPending} /></label>
      <label>API secret<input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.currentTarget.value)} required autoComplete="off" placeholder="••••••••••" disabled={isPending} /></label>
      <button className="finance-button primary" type="submit" disabled={isPending || !apiKey.trim() || !apiSecret.trim()}>
        {isPending ? <><LoaderCircle className="workbook-spinner" size={14} /> Checking with Groww…</> : <><KeyRound size={14} /> {reconnect ? 'Reconnect Groww' : 'Connect Groww'}</>}
      </button>
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
      <p className="groww-privacy"><ShieldCheck size={12} aria-hidden="true" /> Read-only. Orbis only reads holdings and can’t place orders. Your key and secret are encrypted and never shown again.</p>
    </form>
  );
}

export function GrowwPortfolio({ portfolio, isLoading, onRefresh }: { portfolio: GrowwPortfolioData | null; isLoading: boolean; onRefresh: () => void }) {
  const [notice, setNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [isDisconnecting, startDisconnect] = useTransition();
  const holdings = portfolio?.holdings ?? [];
  const connection = portfolio?.connection ?? null;
  const connected = Boolean(connection) && portfolio?.state !== 'not_connected';
  const needsReconnect = connection?.status === 'reconnect_required';

  function disconnect() {
    if (!window.confirm('Disconnect Groww? Orbis will delete the saved key and secret.')) return;
    setNotice(null);
    startDisconnect(async () => {
      const result = await disconnectGrowwAction();
      setNotice({ text: result.message, success: result.success });
      if (result.success) onRefresh();
    });
  }

  return (
    <section className="groww-card" aria-labelledby="groww-title">
      <div className="groww-head">
        <div className="groww-icon"><Image src="/brands/groww.png" alt="Groww" width={24} height={24} /></div>
        <div>
          <small className={needsReconnect ? 'groww-status warn' : connected ? 'groww-status' : 'groww-status off'}>{needsReconnect ? 'NEEDS RECONNECT' : connected ? 'CONNECTED · READ-ONLY' : 'NOT CONNECTED'}</small>
          <h3 id="groww-title">Groww holdings</h3>
        </div>
        {connected && (
          <button className="groww-refresh" type="button" onClick={onRefresh} disabled={isLoading} aria-label="Sync Groww holdings">
            {isLoading ? <LoaderCircle className="workbook-spinner" size={15} /> : <RefreshCw size={15} />}
          </button>
        )}
      </div>

      {!portfolio && <p className="groww-muted">Checking your Groww connection…</p>}
      {notice && <p className={`finance-notice ${notice.success ? 'success' : 'error'}`} role="status">{notice.text}</p>}
      {portfolio?.state === 'not_connected' && <GrowwConnectForm reconnect={false} setupMessage={portfolio.setupRequired ? portfolio.message : undefined} onConnected={onRefresh} />}
      {portfolio?.state === 'error' && <p className="finance-notice error">{portfolio.message}</p>}
      {portfolio?.state === 'error' && needsReconnect && connection?.source === 'account' && <GrowwConnectForm reconnect onConnected={onRefresh} />}

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
          ) : <p className="groww-muted">No stock or ETF holdings in your Groww demat account.</p>}

          <p className="groww-muted">
            Prices: NAV from AMFI for ETFs (published daily), BSE quotes from Alpha Vantage for shares.
            {!portfolio.livePrices && ' Holdings without a price count at the amount invested.'}
            {' '}Mutual funds aren’t available through the Groww Trade API; add them below with their ISIN.
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
      {connected && connection?.source === 'server' && <p className="groww-muted">Connected with the server’s Groww keys.</p>}
    </section>
  );
}
