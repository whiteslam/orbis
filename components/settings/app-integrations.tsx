'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { CalendarDays, HeartPulse, Mail, Unplug } from 'lucide-react';
import { disconnectGmailAction } from '@/app/finance/actions';
import { disconnectBrokerAction } from '@/app/invest/actions';
import { BrokerConnectForm } from '@/components/money/broker-card';
import { BROKERS, type BrokerId, type BrokerMeta } from '@/lib/invest/brokers';
import type { StepsSummary } from '@/lib/health/types';
import type { AppConnections } from '@/lib/providers/status';
import { safeAction } from '@/lib/client/safe-action';

function when(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function Status({ state, children }: Readonly<{ state: 'on' | 'off' | 'warn'; children: React.ReactNode }>) {
  return <span className={`pf-status ${state}`}><i aria-hidden="true" />{children}</span>;
}

/** Connected, waiting on a reconnect, or not connected at all. */
function ConnectionStatus({ linked, expired }: Readonly<{ linked: boolean; expired: boolean }>) {
  if (!linked) return <Status state="off">Not connected</Status>;
  return expired ? <Status state="warn">Reconnect</Status> : <Status state="on">Connected</Status>;
}

/** One app: a tile, its name and what it reads, and where the connection stands. */
function AppHead({ tile, name, detail, status }: Readonly<{ tile: React.ReactNode; name: string; detail: string; status: React.ReactNode }>) {
  return (
    <div className="pf-app-head">
      <span className="fd-tile pf-tile" aria-hidden="true">{tile}</span>
      <div><strong><span>{name}</span><span className="pf-readonly">Read-only</span></strong><small>{detail}</small></div>
      {status}
    </div>
  );
}

type ActionResult = { success: boolean; message: string };
type RunAction = (confirmText: string, action: () => Promise<ActionResult>) => void;

function GoogleApp({ google, isPending, run }: Readonly<{ google: AppConnections['google']; isPending: boolean; run: RunAction }>) {
  const googleNeedsReconnect = google?.status === 'reconnect_required';
  return (
    <article className="pf-app">
      <AppHead
        tile={<b>G</b>}
        name="Google"
        detail={google ? google.email : 'Important mail and Calendar, read-only'}
        status={<ConnectionStatus linked={Boolean(google)} expired={googleNeedsReconnect} />}
      />
      <ul className="pf-scopes">
        <li className={google?.gmail ? 'on' : undefined}><Mail size={13} aria-hidden="true" />Gmail · important mail on Today{google && !google.gmail ? ' · not granted' : ''}</li>
        <li className={google?.calendar ? 'on' : undefined}><CalendarDays size={13} aria-hidden="true" />Calendar · events for your daily notifications{google && !google.calendar ? ' · not granted' : ''}</li>
      </ul>
      <div className="fd-act pf-act">
        {!google && <a className="fd-button" href="/auth/gmail/start?return=settings">Connect Google</a>}
        {google && (googleNeedsReconnect || !google.calendar) && <a className="fd-button" href="/auth/gmail/start?return=settings">{googleNeedsReconnect ? 'Reconnect Google' : 'Add Calendar access'}</a>}
        {google && <button className="fd-link alert" type="button" disabled={isPending} onClick={() => run('Disconnect Google? Orbis will stop reading your important mail and Calendar.', safeAction(disconnectGmailAction))}><Unplug size={13} aria-hidden="true" /> Disconnect</button>}
      </div>
    </article>
  );
}

function brokerLinkLabel(name: string, expired: boolean, linked: boolean) {
  if (expired) return `Reconnect ${name}`;
  if (linked) return `Refresh ${name}`;
  return `Connect ${name}`;
}

/** A redirect broker links out to its own login; a key broker opens its form here. */
function BrokerConnect({ meta, linked, expired, setup, formOpen, setOpenForm }: Readonly<{
  meta: BrokerMeta;
  linked: boolean;
  expired: boolean;
  setup: string | undefined;
  formOpen: boolean;
  setOpenForm: (id: BrokerId | null) => void;
}>) {
  if (meta.connect === 'redirect') {
    if (setup) return <span className="fd-note tight">{setup}</span>;
    return <a className="fd-button" href={meta.connectPath ?? '/'}>{brokerLinkLabel(meta.name, expired, linked)}</a>;
  }
  return (<>
    {!linked && !formOpen && <button type="button" onClick={() => setOpenForm(meta.id)}>Connect {meta.name}</button>}
    {!linked && formOpen && <button className="fd-link" type="button" onClick={() => setOpenForm(null)}>Cancel</button>}
  </>);
}

function BrokerApp({ meta, connections, openForm, setOpenForm, isPending, run }: Readonly<{
  meta: BrokerMeta;
  connections: AppConnections;
  openForm: BrokerId | null;
  setOpenForm: (id: BrokerId | null) => void;
  isPending: boolean;
  run: RunAction;
}>) {
  const linked = connections.brokers[meta.id] ?? null;
  const setup = connections.brokerSetupMessages[meta.id];
  const expired = linked?.status === 'reconnect_required';
  const formOpen = openForm === meta.id;
  const synced = linked?.lastSyncAt ? ` · synced ${when(linked.lastSyncAt)}` : '';
  return (
    <article className="pf-app">
      <AppHead
        tile={<Image src={meta.logo} alt="" width={20} height={20} />}
        name={meta.name}
        detail={`${meta.covers.charAt(0).toLocaleUpperCase()}${meta.covers.slice(1)}, read-only${synced}`}
        status={<ConnectionStatus linked={Boolean(linked)} expired={expired} />}
      />
      {expired && meta.connect === 'redirect' && <p className="fd-note tight">{meta.sessionNote}</p>}
      {formOpen && meta.connect === 'keys' && (
        <BrokerConnectForm meta={meta} reconnect={Boolean(linked)} setupMessage={setup} onConnected={() => setOpenForm(null)} />
      )}
      {setup && !formOpen && <p className="fd-note tight">{setup}</p>}
      {(!linked || linked.source === 'account') && (
        <div className="fd-act pf-act">
          <BrokerConnect meta={meta} linked={Boolean(linked)} expired={expired} setup={setup} formOpen={formOpen} setOpenForm={setOpenForm} />
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
}

function HealthApp({ stepsSummary, openHealth }: Readonly<{ stepsSummary: StepsSummary; openHealth: () => void }>) {
  const lastImport = stepsSummary.lastImport;
  return (
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
  );
}

export function AppIntegrations({ connections, stepsSummary, openHealth }: Readonly<{ connections: AppConnections; stepsSummary: StepsSummary; openHealth: () => void }>) {
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  // Which broker's key form is open, if any. One at a time.
  const [openForm, setOpenForm] = useState<BrokerId | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(confirmText: string, action: () => Promise<ActionResult>) {
    if (!window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
    });
  }

  return (
    <div className="pf-apps">
      {message && <output className={`fd-msg ${message.success ? 'ok' : 'bad'}`}>{message.text}</output>}

      <GoogleApp google={connections.google} isPending={isPending} run={run} />

      {/* Every broker in the registry, so adding one is a registry entry and not
          another block here. A redirect broker (Kite) has no form to open: it
          links out to its own login, and does so again each day. */}
      {BROKERS.map((meta) => (
        <BrokerApp key={meta.id} meta={meta} connections={connections} openForm={openForm} setOpenForm={setOpenForm} isPending={isPending} run={run} />
      ))}

      <HealthApp stepsSummary={stepsSummary} openHealth={openHealth} />
    </div>
  );
}
