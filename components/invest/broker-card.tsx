'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { connectBrokerAction, disconnectBrokerAction } from '@/app/invest/actions';
import type { BrokerMeta } from '@/lib/invest/brokers';
import type { BrokerPortfolio, PriceSource } from '@/lib/invest/types';
import { inr, signedInr } from '@/components/invest/format';
import { FieldLabel, FieldStep, FieldSubHead } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

const SOURCE_LABEL: Record<PriceSource, string> = { groww: 'LTP', amfi: 'NAV', alpha_vantage: 'BSE', coingecko: 'Price' };

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: value.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(date);
}

function syncedAt(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

/**
 * The key and secret fields for one broker. With `steps` (the default) it
 * carries its own intro and two-step instructions, for use inline (Profile →
 * Settings); the Connect screen draws those itself and passes `steps={false}`.
 */
export function BrokerConnectForm({ meta, reconnect, setupMessage, onConnected, steps = true }: { meta: BrokerMeta; reconnect: boolean; setupMessage?: string; onConnected: () => void; steps?: boolean }) {
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
    <form className="fd-form broker-connect" onSubmit={submit}>
      {steps && <>
        <p className="fd-lead">{reconnect ? `${meta.name} stopped accepting the saved key. Paste a fresh key and secret to sync again.` : `Link your ${meta.name} account to sync your ${meta.covers} automatically.`}</p>
        <BrokerSteps meta={meta} />
      </>}
      <label className="fd-field wide">{meta.fields.key}<textarea className="mono" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} rows={2} required autoComplete="off" spellCheck={false} placeholder={meta.fields.keyPlaceholder} disabled={isPending} /></label>
      <label className="fd-field wide">{meta.fields.secret}<input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.currentTarget.value)} required autoComplete="off" placeholder="••••••••••" disabled={isPending} /></label>
      <div className="fd-act">
        <button type="submit" disabled={isPending || !apiKey.trim() || !apiSecret.trim()}>
          {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Checking with {meta.name}…</> : <><KeyRound size={14} aria-hidden="true" /> {reconnect ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}</>}
        </button>
      </div>
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
      <p className="fd-shield"><ShieldCheck size={13} aria-hidden="true" /> Read-only. Orbis only reads holdings and can’t place orders. Your key and secret are encrypted at rest and never shown again.</p>
    </form>
  );
}

function BrokerSteps({ meta }: { meta: BrokerMeta }) {
  return (
    <>
      <FieldStep n={1} title={`Generate a key at ${meta.name}`}>
        Open <a href={meta.keysUrl} target="_blank" rel="noreferrer">{meta.keysLabel} <ExternalLink size={10} aria-hidden="true" /></a> and create a key.
      </FieldStep>
      <FieldStep n={2} title="Paste both values below">
        The {meta.fields.key} and the {meta.fields.secret.replace(/^API /i, '').toLowerCase()}. Orbis encrypts them and never shows them again.
      </FieldStep>
    </>
  );
}

/** The Connect view: what linking does, the two steps, the form, and what will sync. */
export function BrokerConnectScreen({ meta, reconnect, setupMessage, others, onBack, onConnected, onOpen }: { meta: BrokerMeta; reconnect: boolean; setupMessage?: string; others: Array<{ meta: BrokerMeta; connected: boolean }>; onBack: () => void; onConnected: () => void; onOpen: (id: BrokerMeta['id']) => void }) {
  const covers = meta.covers.charAt(0).toLocaleUpperCase() + meta.covers.slice(1);
  return (
    <>
      <FieldSubHead
        crumb="Invest · accounts"
        title={reconnect ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}
        lead={reconnect ? `${meta.name} stopped accepting the saved key. Paste a fresh key and secret to sync again.` : `Link your account and Orbis syncs your ${meta.covers} on its own. It reads holdings — it cannot place an order.`}
        onBack={onBack}
        backLabel="Back to Invest"
      />
      <FieldLabel>Two steps</FieldLabel>
      <BrokerSteps meta={meta} />
      <BrokerConnectForm meta={meta} reconnect={reconnect} setupMessage={setupMessage} onConnected={onConnected} steps={false} />

      <section className="fd-quiet">
        <h2>What syncs</h2>
        <div className="fd-line"><span>Holdings</span><b>{covers}</b></div>
        <div className="fd-line"><span>Prices</span><b>{meta.pricesShort}</b></div>
        <div className="fd-line"><span>Refresh</span><b>When you open Invest</b></div>
      </section>
      {meta.gapNote && <p className="fd-note">{meta.gapNote}</p>}

      {others.length > 0 && (
        <section className="fd-quiet">
          <h2>Other accounts</h2>
          {others.map((other) => (
            <div className="fd-line" key={other.meta.id}>
              <span className="fd-two">{other.meta.name}<small>{other.connected ? 'connected' : 'not connected'}</small></span>
              {!other.connected && <button className="fd-link" type="button" onClick={() => onOpen(other.meta.id)}>Connect</button>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/**
 * One connected account: its state, its holdings, and the controls for the
 * connection itself. Every provider renders through this, so the screen grows
 * by adding an entry to the broker registry rather than another component.
 */
export function BrokerCard({ meta, portfolio, isLoading, onRefresh, onConnect }: { meta: BrokerMeta; portfolio: BrokerPortfolio | null; isLoading: boolean; onRefresh: () => void; onConnect: (reconnect: boolean) => void }) {
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

  // Not connected: one quiet row. The form lives on its own Connect view.
  if (portfolio?.state === 'not_connected' && !notice) {
    return (
      <div className="fd-line">
        <span className="fd-two">{meta.name}<small>{portfolio.setupRequired ? 'not set up on this server' : 'not connected'}</small></span>
        <button className="fd-link" type="button" onClick={() => onConnect(false)}>Connect</button>
      </div>
    );
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
      {portfolio?.state === 'error' && <p className="finance-notice error">{portfolio.message}</p>}
      {portfolio?.state === 'error' && needsReconnect && connection?.source === 'account' && <div className="fd-act"><button type="button" onClick={() => onConnect(true)}>Reconnect {meta.name}</button></div>}

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
