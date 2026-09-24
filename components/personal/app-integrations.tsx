'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CalendarDays, HeartPulse, Mail, Unplug } from 'lucide-react';
import { disconnectGmailAction } from '@/app/finance/actions';
import { disconnectGrowwAction } from '@/app/invest/actions';
import { GrowwConnectForm } from '@/components/invest/groww-portfolio';
import type { StepsSummary } from '@/lib/health/types';
import type { AppConnections } from '@/lib/providers/status';

function when(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function Status({ state, children }: { state: 'on' | 'off' | 'warn'; children: React.ReactNode }) {
  return <span className={`app-status ${state}`}><i aria-hidden="true" />{children}</span>;
}

export function AppIntegrations({ connections, stepsSummary, openHealth }: { connections: AppConnections; stepsSummary: StepsSummary; openHealth: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [showGrowwForm, setShowGrowwForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { google, groww } = connections;

  function run(confirmText: string, action: () => Promise<{ success: boolean; message: string }>) {
    if (!window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  const googleNeedsReconnect = google?.status === 'reconnect_required';
  const lastImport = stepsSummary.lastImport;

  return (
    <div className="app-integrations">
      {message && <p className={`finance-notice ${message.success ? 'success' : 'error'}`} role="status">{message.text}</p>}

      <article className="app-card">
        <div className="app-card-head">
          <div className="app-logo google" aria-hidden="true">G</div>
          <div><strong>Google</strong><small>{google ? google.email : 'Gmail alerts and Calendar, read-only'}</small></div>
          {google ? <Status state={googleNeedsReconnect ? 'warn' : 'on'}>{googleNeedsReconnect ? 'Reconnect' : 'Connected'}</Status> : <Status state="off">Not connected</Status>}
        </div>
        <ul className="app-scopes">
          <li className={google?.gmail ? 'on' : ''}><Mail size={13} aria-hidden="true" />Gmail · bank and card alerts{google?.gmail && google.lastSyncAt ? ` · synced ${when(google.lastSyncAt)}` : ''}</li>
          <li className={google?.calendar ? 'on' : ''}><CalendarDays size={13} aria-hidden="true" />Calendar · events for your daily notifications</li>
        </ul>
        <div className="app-card-actions">
          {!google && <a className="finance-button primary" href="/auth/gmail/start?return=settings">Connect Google</a>}
          {google && (googleNeedsReconnect || !google.calendar) && <a className="finance-button primary" href="/auth/gmail/start?return=settings">{googleNeedsReconnect ? 'Reconnect Google' : 'Add Calendar access'}</a>}
          {google && <button className="finance-button secondary app-disconnect" type="button" disabled={isPending} onClick={() => run('Disconnect Google? Orbis will stop reading Gmail alerts and Calendar.', disconnectGmailAction)}><Unplug size={13} /> Disconnect</button>}
        </div>
      </article>

      <article className="app-card">
        <div className="app-card-head">
          <div className="app-logo"><Image src="/brands/groww.png" alt="" width={22} height={22} /></div>
          <div><strong>Groww</strong><small>Stocks and ETFs, read-only{groww?.lastSyncAt ? ` · synced ${when(groww.lastSyncAt)}` : ''}</small></div>
          {groww ? <Status state={groww.status === 'connected' ? 'on' : 'warn'}>{groww.status === 'connected' ? 'Connected' : 'Reconnect'}</Status> : <Status state="off">Not connected</Status>}
        </div>
        {(!groww || groww.status !== 'connected') && (showGrowwForm || groww)
          ? <GrowwConnectForm reconnect={Boolean(groww)} setupMessage={connections.growwSetupMessage ?? undefined} onConnected={() => { setShowGrowwForm(false); router.refresh(); }} />
          : null}
        <div className="app-card-actions">
          {!groww && !showGrowwForm && <button className="finance-button primary" type="button" onClick={() => setShowGrowwForm(true)}>Connect Groww</button>}
          {groww?.source === 'account' && <button className="finance-button secondary app-disconnect" type="button" disabled={isPending} onClick={() => run('Disconnect Groww? Orbis will delete the saved key and secret.', disconnectGrowwAction)}><Unplug size={13} /> Disconnect</button>}
          {groww?.source === 'server' && <small className="groww-muted">Using the server’s Groww keys.</small>}
        </div>
      </article>

      <article className="app-card">
        <div className="app-card-head">
          <div className="app-logo health" aria-hidden="true"><HeartPulse size={17} /></div>
          <div><strong>Apple Health</strong><small>{lastImport ? `Last import ${when(lastImport.importedAt)}` : 'Import your steps from the Health app export'}</small></div>
          {lastImport ? <Status state="on">Imported</Status> : <Status state="off">Not imported</Status>}
        </div>
        <div className="app-card-actions">
          <button className="finance-button secondary" type="button" onClick={openHealth}>{lastImport ? 'Import newer data' : 'Import from Health'}</button>
        </div>
      </article>
    </div>
  );
}
