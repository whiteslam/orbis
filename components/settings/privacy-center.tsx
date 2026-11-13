'use client';

import { useCallback, useEffect, useState, useTransition, type FormEvent } from 'react';
import { BatteryCharging, LoaderCircle, Plus, Settings2, Trash2 } from 'lucide-react';
import { deleteSourceData, listDevices, revokeDevice, type DeviceRow } from '@/app/personal/device-actions';
import { usePersonLocale } from '@/components/locale/person-locale';
import { useNativeApp, usePhoneLink } from '@/components/native/use-native';
import { safeAction } from '@/lib/client/safe-action';
import { SOURCES, type Source } from '@/lib/device/sources';
import { batteryHelp } from '@/lib/native/battery-help';
import { linkThisPhone, pushPlugin } from '@/lib/native/link-phone';
import { OrbisCore, type ActivityEntry, type CoreStatus, type LauncherApp, type Privacy, type TestCaptureResult } from '@/lib/native/orbis-core';
import { pauseUntil, type PauseChoice } from '@/lib/native/pause';
import { activityWords, addToList, blockedFirst, lastSeenWords, MAX_ITEM_CHARS, pauseState, reasonWords, SOURCE_LABELS, syncWords, toggleBlocked } from '@/lib/native/privacy-words';

type Message = { text: string; success: boolean } | null;

const destructive = { background: 'var(--fd-alert)', color: 'var(--fd-alert-ink)' } as const;
const UNREACHABLE = 'Couldn’t reach this phone’s Orbis service. Try again.';
// Only the Test source reads anything in this version; the others are listed so people see what is coming.
const READY: ReadonlySet<Source> = new Set<Source>(['test']);
const APPS_SHOWN = 8;
const ACTIVITY_SHOWN = 10;

function Note({ message }: Readonly<{ message: Message }>) {
  return message ? <output className={`fd-msg ${message.success ? 'ok' : 'bad'}`}>{message.text}</output> : null;
}

/** The phones, or null when they couldn't be read (signed out, locked, offline). */
async function readDevices(): Promise<DeviceRow[] | null> {
  try {
    return await listDevices();
  } catch {
    return null;
  }
}

/** The signed-in person's phones, read through the cookie client; reloaded on demand. */
function useDevices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);

  const apply = useCallback((rows: DeviceRow[] | null) => {
    if (rows) setDevices(rows);
    setFailed(rows === null);
    setNow(Date.now());
  }, []);
  const reload = useCallback(() => readDevices().then(apply), [apply]);

  useEffect(() => { readDevices().then(apply); }, [apply]);
  return { devices, failed, now, reload };
}

/**
 * Settings → What Orbis can see. Inside the Android app it is where people choose
 * what Orbis reads on this phone, and test it; on the web it lists the phones and
 * deletes what Orbis kept on the server.
 *
 * It reads as it mounts: the phone list, and in the app the phone's status, privacy
 * settings, activity and apps. Settings mounts it only once its section is on screen.
 */
export function PrivacyCenter({ userId }: Readonly<{ userId: string }>) {
  const nativeApp = useNativeApp();
  const phones = useDevices();
  return nativeApp ? <PhonePrivacy userId={userId} phones={phones} /> : <WebPrivacy phones={phones} />;
}

type Phones = ReturnType<typeof useDevices>;

// ─── On the web ───────────────────────────────────────────────────────────

function WebPrivacy({ phones }: Readonly<{ phones: Phones }>) {
  const on = (source: Source) => (phones.devices ?? []).filter((device) => device.sources.includes(source)).length;
  return (
    <>
      <YourPhones phones={phones} thisDeviceId={null} />
      <p className="fd-note tight">Install the Android app to choose what Orbis reads.</p>
      <h3 className="fd-label st-sub">What Orbis kept</h3>
      <div className="st-cell">
        {SOURCES.map((source) => <KeptRow key={source} source={source} phonesOn={on(source)} />)}
      </div>
      <p className="fd-note tight">What a phone sent: short, encrypted signals and daily counts. The full items stay on the phone.</p>
    </>
  );
}

/** One source on the web: whether a phone reads it, and deleting what the server kept. */
function KeptRow({ source, phonesOn }: Readonly<{ source: Source; phonesOn: number }>) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(deleteSourceData)(source);
      setMessage({ text: result.message, success: result.success });
      if (result.success) setConfirming(false);
    });
  }

  let state = 'Off on every phone';
  if (phonesOn) state = phonesOn === 1 ? 'On for 1 phone' : `On for ${phonesOn} phones`;
  return (
    <div className="fd-source" style={{ display: 'block' }}>
      <div><strong>{SOURCE_LABELS[source]}</strong><p>{state}</p></div>
      {!confirming && (
        <div className="fd-act">
          <button className="fd-link alert" type="button" onClick={() => { setMessage(null); setConfirming(true); }}><Trash2 size={13} aria-hidden="true" /> Delete what Orbis kept</button>
        </div>
      )}
      {confirming && (
        <fieldset aria-label={`Confirm deleting what Orbis kept from ${SOURCE_LABELS[source]}`}>
          <p className="fd-msg">Deletes what Orbis kept on the server from this source. To stop reading it, turn it off in the app.</p>
          <div className="fd-act">
            <button type="button" style={destructive} disabled={isPending} onClick={remove}>{isPending ? 'Deleting…' : 'Delete'}</button>
            <button type="button" className="ghost" disabled={isPending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </fieldset>
      )}
      <Note message={message} />
    </div>
  );
}

// ─── Both: your phones ────────────────────────────────────────────────────

function YourPhones({ phones, thisDeviceId }: Readonly<{ phones: Phones; thisDeviceId: string | null }>) {
  const { devices, failed, now, reload } = phones;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(revokeDevice)(id);
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        setConfirming(null);
        await reload();
      }
    });
  }

  return (
    <>
      <h3 className="fd-label st-sub">Your phones</h3>
      <div className="st-cell">
        {devices === null && !failed && <div className="fd-source"><div><p>Loading your phones…</p></div></div>}
        {failed && (
          <div className="fd-source">
            <div><strong>Your phones couldn’t be loaded</strong><p>Check your connection and try again.</p></div>
            <button type="button" className="fd-button ghost" onClick={() => startTransition(reload)} disabled={isPending}>Try again</button>
          </div>
        )}
        {devices?.length === 0 && !failed && <div className="fd-source"><div><strong>No phones yet</strong><p>Sign in to the Android app and your phone shows here.</p></div></div>}
        {devices?.map((device) => {
          const here = device.id === thisDeviceId;
          const seen = device.lastSeenAt ? `Last seen ${lastSeenWords(device.lastSeenAt, now).toLowerCase()}` : 'Not synced yet';
          const reading = device.sources.length ? `Reading ${device.sources.map((source) => SOURCE_LABELS[source]).join(', ')}` : 'Reading nothing';
          return (
            <div className="fd-source" style={{ display: 'block' }} key={device.id}>
              <div><strong>{device.name}{here ? ' (this phone)' : ''}</strong><p>{seen} · {reading}</p></div>
              {/* This phone leaves through Sign out in Your data, which also wipes it. */}
              {!here && confirming !== device.id && (
                <div className="fd-act">
                  <button className="fd-link alert" type="button" onClick={() => { setMessage(null); setConfirming(device.id); }}>Remove this phone</button>
                </div>
              )}
              {confirming === device.id && (
                <fieldset aria-label={`Confirm removing ${device.name}`}>
                  <p className="fd-msg">It signs out of Orbis the next time it syncs, and stops reading.</p>
                  <div className="fd-act">
                    <button type="button" style={destructive} disabled={isPending} onClick={() => remove(device.id)}>{isPending ? 'Removing…' : 'Remove'}</button>
                    <button type="button" className="ghost" disabled={isPending} onClick={() => setConfirming(null)}>Cancel</button>
                  </div>
                </fieldset>
              )}
            </div>
          );
        })}
      </div>
      <Note message={message} />
    </>
  );
}

// ─── Inside the app ───────────────────────────────────────────────────────

type PhoneRead = {
  /** Null when the phone's Orbis service didn't answer. */
  phone: { status: CoreStatus; privacy: Privacy } | null;
  activity: ActivityEntry[];
  /** Whether Android lets Orbis show notifications; null when that couldn't be checked. */
  notifications: boolean | null;
};

/** Everything the in-app screen shows from the phone, read in one go. Never rejects. */
async function readPhone(): Promise<PhoneRead> {
  const phone = Promise.all([OrbisCore.status(), OrbisCore.getPrivacy()]).then(([status, privacy]) => ({ status, privacy }), () => null);
  const activity = OrbisCore.recentActivity({ limit: 50 }).catch(() => []);
  const notifications = pushPlugin().then((plugin) => plugin.checkPermissions()).then(({ receive }) => receive === 'granted', () => null);
  return { phone: await phone, activity: await activity, notifications: await notifications };
}

function PhonePrivacy({ userId, phones }: Readonly<{ userId: string; phones: Phones }>) {
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [apps, setApps] = useState<LauncherApp[] | null | 'failed'>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [notifications, setNotifications] = useState<boolean | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [now, setNow] = useState(0);

  const apply = useCallback((read: PhoneRead) => {
    if (read.phone) {
      setStatus(read.phone.status);
      setPrivacy(read.phone.privacy);
    }
    setUnreachable(read.phone === null);
    setActivity(read.activity);
    setNotifications(read.notifications);
    setNow(Date.now());
  }, []);
  const refresh = useCallback(() => readPhone().then(apply), [apply]);

  // Read now, and on every return: a source, battery setting or permission may have changed meanwhile.
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === 'visible') readPhone().then(apply); };
    readPhone().then(apply);
    OrbisCore.listApps().then(setApps, () => setApps('failed'));
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, [apply]);

  const { reload: reloadPhones } = phones;
  const onLinked = useCallback(async () => {
    await Promise.all([refresh(), reloadPhones()]);
  }, [refresh, reloadPhones]);

  return (
    <>
      <PhoneLinkNotice userId={userId} registered={status?.registered ?? null} onLinked={onLinked} />
      {unreachable && !status && (
        <div className="st-cell">
          <div className="fd-source">
            <div><strong>This phone’s Orbis service didn’t answer</strong><p>Close Orbis and open it again. If it keeps happening, restart the phone.</p></div>
            <button type="button" className="fd-button ghost" onClick={() => { refresh(); }}>Try again</button>
          </div>
        </div>
      )}
      {!status && !unreachable && <div className="st-cell"><div className="fd-source"><div><p>Checking this phone…</p></div></div></div>}
      {status && (
        <>
          <Sources status={status} onStatus={setStatus} notifications={notifications} onChanged={refresh} />
          {/* Last synced, how many items are waiting, and why the last try failed, if it did. */}
          {status.registered && <p className="fd-note tight">{syncWords(status, now)}</p>}
          <KeepRunning status={status} />
        </>
      )}
      {privacy && (
        <>
          <BlockedApps privacy={privacy} apps={apps} onPrivacy={setPrivacy} />
          <BlockedList kind="blockedContacts" privacy={privacy} onPrivacy={setPrivacy} />
          <BlockedList kind="blockedKeywords" privacy={privacy} onPrivacy={setPrivacy} />
        </>
      )}
      {status && <PauseReading status={status} now={now} onStatus={setStatus} />}
      <div className="st-cell">
        <div className="fd-source">
          <div><strong>Private vault</strong><p>Private Space and Secure Folder are separate from the rest of your phone. Orbis can’t see them.</p></div>
        </div>
      </div>
      <RecentActivity activity={activity} />
      <TryIt apps={Array.isArray(apps) ? apps : []} onDone={refresh} />
      <YourPhones phones={phones} thisDeviceId={status?.deviceId ?? null} />
    </>
  );
}

/**
 * When this phone isn't linked: removed from another device (adding it back is the
 * person's call), or a registration that was refused, such as at ten phones. A
 * refusal is out of date once the phone says it is registered.
 */
function PhoneLinkNotice({ userId, registered, onLinked }: Readonly<{ userId: string; registered: boolean | null; onLinked: () => Promise<void> }>) {
  const { removed, registerError } = usePhoneLink();
  const [isPending, startTransition] = useTransition();
  const refused = registerError !== null && registered !== true;
  if (!removed && !refused) return null;

  function addAgain() {
    startTransition(async () => {
      await linkThisPhone(userId, { again: true });
      await onLinked();
    });
  }

  return (
    <div className="st-cell">
      <div className="fd-source" style={{ display: 'block' }}>
        <div>
          <strong>{removed ? 'This phone was removed from your account.' : 'This phone isn’t added yet'}</strong>
          {/* The server's own words, e.g. "You have 10 phones signed in. Remove one…" */}
          {refused && <p>{registerError.message}</p>}
        </div>
        <div className="fd-act">
          <button type="button" className="pf-pill primary" onClick={addAgain} disabled={isPending}>
            {isPending && <LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" />} {removed ? 'Add this phone again' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What turning a source on means, said before it happens. Only the Test source reads anything yet. */
function TurnOnSheet({ source, busy, onConfirm, onCancel }: Readonly<{ source: Source; busy: boolean; onConfirm: () => void; onCancel: () => void }>) {
  return (
    <fieldset className="st-cell pv-sheet" aria-label={`Turn on ${SOURCE_LABELS[source]}`}>
      <div className="fd-source" style={{ display: 'block' }}>
        <div><strong>Turn on {SOURCE_LABELS[source]}?</strong></div>
        <ul className="pv-points">
          <li><b>What is read:</b> only the made-up items you send from Try it below. Nothing else on this phone.</li>
          <li><b>Kept on this phone:</b> each item, in Orbis’s encrypted store, for 30 days.</li>
          <li><b>Sent to the server:</b> a short, encrypted signal, with codes and passwords masked.</li>
          <li>You can turn it off any time. That deletes what Orbis kept from it.</li>
        </ul>
        <div className="fd-act">
          <button type="button" className="pf-pill primary" disabled={busy} onClick={onConfirm}>{busy ? 'Turning on…' : 'Turn on'}</button>
          <button type="button" className="pf-pill" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </fieldset>
  );
}

function Sources({ status, onStatus, notifications, onChanged }: Readonly<{ status: CoreStatus; onStatus: (status: CoreStatus) => void; notifications: boolean | null; onChanged: () => Promise<void> }>) {
  const [asking, setAsking] = useState<Source | null>(null);
  const [turningOff, setTurningOff] = useState<Source | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const anyOn = SOURCES.some((source) => status.sources[source]);

  function turnOn(source: Source) {
    setMessage(null);
    startTransition(async () => {
      try {
        onStatus(await OrbisCore.setSource({ source, enabled: true }));
        setAsking(null);
        setMessage({ text: `${SOURCE_LABELS[source]} is on.`, success: true });
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
      }
    });
  }

  function turnOff(source: Source) {
    setMessage(null);
    startTransition(async () => {
      try {
        // The phone first: it stops reading and deletes its own copy at once.
        onStatus(await OrbisCore.setSource({ source, enabled: false }));
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
        return;
      }
      setTurningOff(null);
      const result = await safeAction(deleteSourceData)(source);
      setMessage(result.success
        ? { text: `${SOURCE_LABELS[source]} is off. What Orbis kept from it is deleted.`, success: true }
        : { text: `${SOURCE_LABELS[source]} is off and its items on this phone are deleted, but the server’s copy wasn’t. ${result.message}`, success: false });
      await onChanged();
    });
  }

  return (
    <>
      <h3 className="fd-label st-sub">Sources</h3>
      <div className="st-cell st-switches pv-sources">
        {SOURCES.map((source) => {
          const ready = READY.has(source);
          return (
            <label className="fd-line" key={source}>
              <span>{SOURCE_LABELS[source]}{!ready && <small>Coming soon</small>}</span>
              <input
                type="checkbox"
                role="switch"
                aria-label={SOURCE_LABELS[source]}
                checked={status.sources[source]}
                disabled={!ready || !status.registered || isPending}
                onChange={(event) => {
                  setMessage(null);
                  if (event.currentTarget.checked) { setTurningOff(null); setAsking(source); } else { setAsking(null); setTurningOff(source); }
                }}
              />
            </label>
          );
        })}
      </div>
      <p className="fd-note tight">Nothing is read until you turn it on.{!status.registered && ' Sources can be turned on once this phone is added to your account.'}</p>
      {anyOn && notifications === false && <p className="fd-note tight">Turn on notifications for this phone in Notifications above, so “Orbis is active” shows while it reads.</p>}
      {asking && <TurnOnSheet source={asking} busy={isPending} onConfirm={() => turnOn(asking)} onCancel={() => setAsking(null)} />}
      {turningOff && (
        <fieldset className="st-cell pv-sheet" aria-label={`Turn off ${SOURCE_LABELS[turningOff]}`}>
          <div className="fd-source" style={{ display: 'block' }}>
            <div><strong>Turn off {SOURCE_LABELS[turningOff]}?</strong><p>This deletes what Orbis kept from it on this phone and on the server.</p></div>
            <div className="fd-act">
              <button type="button" style={destructive} disabled={isPending} onClick={() => turnOff(turningOff)}>{isPending ? 'Turning off…' : 'Turn off and delete'}</button>
              <button type="button" className="pf-pill" disabled={isPending} onClick={() => setTurningOff(null)}>Cancel</button>
            </div>
          </div>
        </fieldset>
      )}
      <Note message={message} />
    </>
  );
}

/** Shown only while Android may stop Orbis in the background to save battery. */
function KeepRunning({ status }: Readonly<{ status: CoreStatus }>) {
  const [message, setMessage] = useState<Message>(null);
  if (!status.batteryOptimized) return null;
  const help = batteryHelp(status.manufacturer);
  const open = (go: () => Promise<void>) => {
    setMessage(null);
    go().catch(() => setMessage({ text: 'That settings page couldn’t be opened. Open it from Android Settings → Apps → Orbis.', success: false }));
  };
  return (
    <div className="st-cell">
      <div className="fd-source" style={{ display: 'block' }}>
        <div>
          <strong>Keep Orbis running</strong>
          <p>{help.brand === 'Android' ? 'Android' : `Your ${help.brand} phone`} may stop Orbis in the background to save battery. To keep it reading:</p>
        </div>
        <ol className="pv-steps">{help.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <div className="fd-act">
          <button type="button" className="pf-pill primary" onClick={() => open(OrbisCore.openBatterySettings)}><BatteryCharging size={13} aria-hidden="true" /> Open battery settings</button>
          <button type="button" className="pf-pill" onClick={() => open(OrbisCore.openAppInfo)}><Settings2 size={13} aria-hidden="true" /> Open app info</button>
        </div>
        <Note message={message} />
      </div>
    </div>
  );
}

function BlockedApps({ privacy, apps, onPrivacy }: Readonly<{ privacy: Privacy; apps: LauncherApp[] | null | 'failed'; onPrivacy: (privacy: Privacy) => void }>) {
  const [all, setAll] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const blocked = privacy.blockedPackages;

  function toggle(packageName: string, on: boolean) {
    setMessage(null);
    startTransition(async () => {
      const next = toggleBlocked(blocked, packageName, on);
      try {
        await OrbisCore.setPrivacy({ blockedPackages: next });
        onPrivacy({ ...privacy, blockedPackages: next });
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
      }
    });
  }

  const sorted = Array.isArray(apps) ? blockedFirst(apps, blocked) : [];
  const shown = all ? sorted : sorted.slice(0, APPS_SHOWN);
  return (
    <>
      <h3 className="fd-label st-sub">Blocked apps</h3>
      <div className="pf-slots">
        {apps === null && <div className="pf-slot"><span><small>Loading your apps…</small></span></div>}
        {apps === 'failed' && <div className="pf-slot"><span><small>Your apps couldn’t be listed. Close Settings and open it again.</small></span></div>}
        {shown.map((app) => (
          <label className="pf-slot" key={app.packageName}>
            <input type="checkbox" aria-label={`Block ${app.label}`} checked={blocked.includes(app.packageName)} disabled={isPending} onChange={(event) => toggle(app.packageName, event.currentTarget.checked)} />
            <span><strong>{app.label}</strong></span>
          </label>
        ))}
      </div>
      {sorted.length > APPS_SHOWN && <button type="button" className="fd-link pv-more" onClick={() => setAll(!all)}>{all ? 'Show fewer apps' : `Show all ${sorted.length} apps`}</button>}
      <p className="fd-note tight">Orbis never reads anything from a ticked app. Banking apps, authenticators and password managers start ticked.</p>
      <Note message={message} />
    </>
  );
}

const LISTS = {
  blockedContacts: {
    title: 'Blocked contacts',
    label: 'Phone number',
    placeholder: 'e.g. 98765 43210',
    inputMode: 'tel',
    note: 'Nothing to or from these numbers is read. Numbers are matched by their last 10 digits.',
    refused: 'That doesn’t look like a phone number.',
  },
  blockedKeywords: {
    title: 'Blocked words',
    label: 'Word or phrase',
    placeholder: 'e.g. salary',
    inputMode: 'text',
    note: 'An item that contains one of these is never kept.',
    refused: 'That couldn’t be added.',
  },
} as const;

/** Blocked contacts or blocked words: a row each, and a field to add one. */
function BlockedList({ kind, privacy, onPrivacy }: Readonly<{ kind: 'blockedContacts' | 'blockedKeywords'; privacy: Privacy; onPrivacy: (privacy: Privacy) => void }>) {
  const words = LISTS[kind];
  const items = privacy[kind];
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function save(next: string[], added: boolean) {
    setMessage(null);
    startTransition(async () => {
      try {
        await OrbisCore.setPrivacy({ [kind]: next });
        // Read back: the phone tidies what it keeps (numbers become their last 10 digits).
        const saved = await OrbisCore.getPrivacy();
        onPrivacy(saved);
        if (added) {
          if (saved[kind].length > items.length) setDraft('');
          else setMessage({ text: words.refused, success: false });
        }
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
      }
    });
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const next = addToList(items, draft);
    if (next.length === items.length) {
      setMessage({ text: draft.trim() ? 'That’s already on the list, or too long.' : 'Type something to add.', success: false });
      return;
    }
    save(next, true);
  }

  const id = `privacy-${kind}`;
  return (
    <>
      <h3 className="fd-label st-sub">{words.title}</h3>
      <div className="st-cell">
        {items.map((item) => (
          <div className="fd-source" key={item}>
            <div><strong className="pv-item">{item}</strong></div>
            <button type="button" className="fd-button ghost" aria-label={`Remove ${item}`} disabled={isPending} onClick={() => save(items.filter((entry) => entry !== item), false)}>Remove</button>
          </div>
        ))}
        <form className="fd-source pv-add" onSubmit={add} aria-label={`Add to ${words.title.toLowerCase()}`}>
          <label className="fd-field" htmlFor={id}>{words.label}</label>
          <div className="pf-city-row">
            <input id={id} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} maxLength={MAX_ITEM_CHARS} placeholder={words.placeholder} inputMode={words.inputMode} autoComplete="off" disabled={isPending} />
            <button className="pf-pill" type="submit" disabled={isPending || !draft.trim()}><Plus size={13} aria-hidden="true" /> Add</button>
          </div>
        </form>
      </div>
      <p className="fd-note tight">{words.note}</p>
      <Note message={message} />
    </>
  );
}

const PAUSES: Array<{ choice: PauseChoice; label: string }> = [
  { choice: 'hour', label: 'For an hour' },
  { choice: 'tomorrow', label: 'Until tomorrow' },
  { choice: 'forever', label: 'Until I turn it back on' },
];

function PauseReading({ status, now, onStatus }: Readonly<{ status: CoreStatus; now: number; onStatus: (status: CoreStatus) => void }>) {
  const { locale } = usePersonLocale();
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const state = pauseState(status.pausedUntil, now);

  function pause(until: number) {
    setMessage(null);
    startTransition(async () => {
      try {
        onStatus(await OrbisCore.pause({ until }));
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
      }
    });
  }

  let line = 'Orbis reads the sources you turned on.';
  // The phone's own clock and zone: that is where the pause runs.
  if (state.kind === 'until') line = `Paused until ${new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(state.at)}.`;
  if (state.kind === 'forever') line = 'Paused until you turn it back on.';
  return (
    <>
      <h3 className="fd-label st-sub">Pause</h3>
      <div className="st-cell">
        <div className="fd-source" style={{ display: 'block' }}>
          <div><strong>{state.kind === 'off' ? 'Reading' : 'Paused'}</strong><p>{line}</p></div>
          <div className="fd-act">
            {state.kind === 'off'
              ? PAUSES.map(({ choice, label }) => <button type="button" className="pf-pill" key={choice} disabled={isPending} onClick={() => pause(pauseUntil(choice, new Date()))}>{label}</button>)
              : <button type="button" className="pf-pill primary" disabled={isPending} onClick={() => pause(0)}>Resume</button>}
          </div>
        </div>
      </div>
      <p className="fd-note tight">While paused, Orbis reads nothing on this phone.</p>
      <Note message={message} />
    </>
  );
}

function RecentActivity({ activity }: Readonly<{ activity: ActivityEntry[] | null }>) {
  const { locale } = usePersonLocale();
  const [all, setAll] = useState(false);
  const entries = activity ?? [];
  const shown = all ? entries : entries.slice(0, ACTIVITY_SHOWN);
  const time = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <>
      <h3 className="fd-label st-sub">Recent activity</h3>
      <div className="pf-services">
        {activity === null && <div className="fd-line pf-service"><span className="fd-two"><small>Loading…</small></span></div>}
        {activity?.length === 0 && <div className="fd-line pf-service"><span className="fd-two">Nothing yet<small>What Orbis reads or leaves out shows here.</small></span></div>}
        {shown.map((entry, index) => {
          const words = activityWords(entry);
          return (
            // Entries carry no id; time, source and position together are unique in this list.
            <div className="fd-line pf-service" key={`${entry.at}-${entry.source}-${index}`}>
              <span className="fd-two">{words.source}<small>{time.format(entry.at)}</small></span>
              <span className="pf-service-state">
                <b className={words.decision === 'Kept' ? 'fd-yes' : undefined}>{words.decision}</b>
                {words.reason && <small>{words.reason}</small>}
              </span>
            </div>
          );
        })}
      </div>
      {entries.length > ACTIVITY_SHOWN && <button type="button" className="fd-link pv-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${entries.length}`}</button>}
      <p className="fd-note tight">The last 50 things Orbis read or left out on this phone. Only the source, time and decision are recorded, never what they said.</p>
    </>
  );
}

/** A made-up Test-source item through the same rules, to see what Orbis would keep. */
function TryIt({ apps, onDone }: Readonly<{ apps: LauncherApp[]; onDone: () => Promise<void> }>) {
  const [app, setApp] = useState('');
  const [contact, setContact] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<TestCaptureResult | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function run(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await OrbisCore.testCapture({ text, ...(app ? { app } : {}), ...(contact.trim() ? { contact: contact.trim() } : {}) }));
        await onDone();
      } catch {
        setMessage({ text: UNREACHABLE, success: false });
      }
    });
  }

  return (
    <>
      <h3 className="fd-label st-sub">Try it</h3>
      <form className="st-cell" onSubmit={run} aria-label="Try the privacy rules">
        <div className="fd-source pv-try" style={{ display: 'block' }}>
          <label className="fd-field" htmlFor="privacy-try-app">
            App
            <select id="privacy-try-app" value={app} onChange={(event) => setApp(event.currentTarget.value)} disabled={isPending}>
              <option value="">No app</option>
              {apps.map((item) => <option key={item.packageName} value={item.packageName}>{item.label}</option>)}
            </select>
          </label>
          <label className="fd-field wide" htmlFor="privacy-try-contact">
            Contact
            <input id="privacy-try-contact" value={contact} onChange={(event) => setContact(event.currentTarget.value)} inputMode="tel" autoComplete="off" maxLength={MAX_ITEM_CHARS} placeholder="Optional phone number" disabled={isPending} />
          </label>
          <label className="fd-field wide" htmlFor="privacy-try-text">
            Text
            <textarea id="privacy-try-text" rows={3} value={text} onChange={(event) => setText(event.currentTarget.value)} maxLength={10_000} placeholder="e.g. Your OTP is 123456" disabled={isPending} />
          </label>
          <div className="fd-act">
            <button type="submit" className="pf-pill primary" disabled={isPending || !text.trim()}>{isPending ? 'Checking…' : 'Try it'}</button>
          </div>
          {result?.decision === 'kept' && <output className="fd-msg ok pv-result">Kept as: <q>{result.masked ?? ''}</q></output>}
          {result?.decision === 'dropped' && <output className="fd-msg pv-result">Dropped: {reasonWords(result.reason)}</output>}
          <Note message={message} />
        </div>
      </form>
      <p className="fd-note tight">A made-up item from the Test source, checked by the same rules as everything else. While the Test source is on, a kept item syncs like a real one.</p>
    </>
  );
}
