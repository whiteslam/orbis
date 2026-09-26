'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CalendarDays, HeartPulse, Mail, Unplug } from 'lucide-react';
import { disconnectGmailAction } from '@/app/finance/actions';
import { disconnectBrokerAction } from '@/app/invest/actions';
import { BrokerConnectForm } from '@/components/invest/broker-card';
import { BROKERS, type BrokerId } from '@/lib/invest/brokers';
import type { StepsSummary } from '@/lib/health/types';
import type { AppConnections } from '@/lib/providers/status';
import { safeAction } from '@/lib/client/safe-action';

function when(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function Status({ state, children }: { state: 'on' | 'off' | 'warn'; children: React.ReactNode }) {
  return <span className={`pf-status ${state}`}><i aria-hidden="true" />{children}</span>;
}

/** One app: a tile, its name and what it reads, and where the connection stands. */
function AppHead({ tile, name, detail, status }: { tile: React.ReactNode; name: string; detail: string; status: React.ReactNode }) {
  return (
    <div className="pf-app-head">
      <span className="fd-tile pf-tile" aria-hidden="true">{tile}</span>
      <div><strong>{name}</strong><small>{detail}</small></div>
      {status}
    </div>
  );
}

export function AppIntegrations({ connections, stepsSummary, openHealth }: { connections: AppConnections; stepsSummary: StepsSummary; openHealth: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  // Which broker's key form is open, if any. One at a time.
  const [openForm, setOpenForm] = useState<BrokerId | null>(null);
  const [isPending, startTransition] = useTransition();
  const { google } = connections;

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
    <div className="pf-apps">
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}

      <article className="pf-app">
        <AppHead
          tile={<b>G</b>}
          name="Google"
          detail={google ? google.email : 'Gmail alerts and Calendar, read-only'}
          status={google ? <Status state={googleNeedsReconnect ? 'warn' : 'on'}>{googleNeedsReconnect ? 'Reconnect' : 'Connected'}</Status> : <Status state="off">Not connected</Status>}
        />
        <ul className="pf-scopes">
          <li className={google?.gmail ? 'on' : undefined}><Mail size={13} aria-hidden="true" />Gmail · bank and card alerts{google?.gmail && google.lastSyncAt ? ` · synced ${when(google.lastSyncAt)}` : ''}{google && !google.gmail ? ' · not granted' : ''}</li>
          <li className={google?.calendar ? 'on' : undefined}><CalendarDays size={13} aria-hidden="true" />Calendar · events for your daily notifications{google && !google.calendar ? ' · not granted' : ''}</li>
        </ul>
        <div className="fd-act pf-act">
          {!google && <a className="fd-button" href="/auth/gmail/start?return=settings">Connect Google</a>}
          {google && (googleNeedsReconnect || !google.calendar) && <a className="fd-button" href="/auth/gmail/start?return=settings">{googleNeedsReconnect ? 'Reconnect Google' : 'Add Calendar access'}</a>}
          {google && <button className="fd-link alert" type="button" disabled={isPending} onClick={() => run('Disconnect Google? Orbis will stop reading Gmail alerts and Calendar.', safeAction(disconnectGmailAction))}><Unplug size={13} aria-hidden="true" /> Disconnect</button>}
        </div>
      </article>

      {/* Every broker in the registry, so adding one is a registry entry and not
          another block here. A redirect broker (Kite) has no form to open: it
          links out to its own login, and does so again each day. */}
      {BROKERS.map((meta) => {
        const linked = connections.brokers[meta.id] ?? null;
        const setup = connections.brokerSetupMessages[meta.id];
        const expired = linked?.status === 'reconnect_required';
        const formOpen = openForm === meta.id;
        return (
          <article className="pf-app" key={meta.id}>
            <AppHead
              tile={<Image src={meta.logo} alt="" width={20} height={20} />}
              name={meta.name}
              detail={`${meta.covers.charAt(0).toLocaleUpperCase()}${meta.covers.slice(1)}, read-only${linked?.lastSyncAt ? ` · synced ${when(linked.lastSyncAt)}` : ''}`}
              status={linked
                ? <Status state={expired ? 'warn' : 'on'}>{expired ? 'Reconnect' : 'Connected'}</Status>
                : <Status state="off">Not connected</Status>}
            />
            {expired && meta.connect === 'redirect' && <p className="fd-note tight">{meta.sessionNote}</p>}
            {formOpen && meta.connect === 'keys' && (
              <BrokerConnectForm meta={meta} reconnect={Boolean(linked)} setupMessage={setup} onConnected={() => { setOpenForm(null); router.refresh(); }} />
            )}
            {setup && !formOpen && <p className="fd-note tight">{setup}</p>}
            {(!linked || linked.source === 'account') && (
              <div className="fd-act pf-act">
                {meta.connect === 'redirect'
                  ? (!setup && <a className="fd-button" href={meta.connectPath ?? '/'}>{expired ? `Reconnect ${meta.name}` : linked ? `Refresh ${meta.name}` : `Connect ${meta.name}`}</a>)
                  : (<>
                    {!linked && !formOpen && <button type="button" onClick={() => setOpenForm(meta.id)}>Connect {meta.name}</button>}
                    {!linked && formOpen && <button className="fd-link" type="button" onClick={() => setOpenForm(null)}>Cancel</button>}
                  </>)}
                {linked?.source === 'account' && (
                  <button
                    className="fd-link alert"
                    type="button"
                    disabled={isPending}
                    onClick={() => run(`Disconnect ${meta.name}? Orbis will delete what it saved.`, () => safeAction(disconnectBrokerAction)(meta.id))}
                  ><Unplug size={13} aria-hidden="true" /> Disconnect</button>
                )}
              </div>
            )}
            {linked?.source === 'server' && <p className="fd-note tight">Using the server’s {meta.name} keys.</p>}
          </article>
        );
      })}

      <article className="pf-app">
        <AppHead
          tile={<HeartPulse size={18} strokeWidth={1.9} />}
          name="Apple Health"
          detail={lastImport ? `Last import ${when(lastImport.importedAt)}` : 'Import your steps from the Health app export'}
          status={lastImport ? <Status state="on">Imported</Status> : <Status state="off">Not imported</Status>}
        />
        <div className="fd-act pf-act">
          <button className="ghost" type="button" onClick={openHealth}>{lastImport ? 'Import newer data' : 'Import from Health'}</button>
        </div>
      </article>
    </div>
  );
}
