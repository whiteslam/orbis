'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, LoaderCircle, Send, Settings2, Smartphone } from 'lucide-react';
import { saveNotificationPreferencesAction, sendTestNotificationAction, subscribePushAction, unsubscribePushAction } from '@/app/personal/notification-actions';
import { NOTIFICATION_SLOTS, type NotificationPreferences, type NotificationSettings as Settings } from '@/lib/notifications/preferences';
import { safeAction } from '@/lib/client/safe-action';
import { usePersonLocale } from '@/components/locale/person-locale';
import { useNativeApp, usePhoneLink } from '@/components/native/use-native';
import { isNativeApp, OrbisCore } from '@/lib/native/orbis-core';
import { setPhoneLink } from '@/lib/native/device-state';
import { pushPlugin } from '@/lib/native/link-phone';

type Result = { success: boolean; message: string };
type PhonePermission = 'checking' | 'prompt' | 'denied' | 'granted';

type DeviceState = 'checking' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0);
}

const SERVICE_WORKER_TIMEOUT_MS = 10_000;

/** The active service worker registration, or null if none is ready within `ms`. */
function serviceWorkerReady(ms: number): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => clearTimeout(timer));
}

function isIosBrowserTab() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** " On for 2 other devices.", or nothing when there are none. */
function otherDevicesNote(count: number) {
  if (!count) return '';
  const plural = count === 1 ? '' : 's';
  return ` On for ${count} other device${plural}.`;
}

/** The parts of the preferences this form edits. The zone is the person's own (Settings → Region), never edited here. */
function editable(prefs: NotificationPreferences) {
  return JSON.stringify({ enabled: prefs.enabled, slots: prefs.slots });
}

/**
 * Times are kept in the person's own zone. The form starts again when that
 * zone changes (Settings → Region saved a new one), so it never holds an old one.
 */
export function NotificationSettings({ settings }: Readonly<{ settings: Settings }>) {
  const { timeZone } = usePersonLocale();
  return <NotificationForm key={timeZone} settings={settings} timeZone={timeZone} />;
}

function NotificationForm({ settings, timeZone }: Readonly<{ settings: Settings; timeZone: string }>) {
  const router = useRouter();
  // In the Android app this phone's notifications come from the app (Firebase), not web push.
  const nativeApp = useNativeApp();
  const phonePush = usePhoneLink().push;
  const [prefs, setPrefs] = useState<NotificationPreferences>(settings.preferences);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = editable(prefs) !== editable(settings.preferences);

  useEffect(() => {
    if (isNativeApp()) return;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setDevice(isIosBrowserTab() ? 'ios-install' : 'unsupported');
        return;
      }
      if (Notification.permission === 'denied') return setDevice('blocked');
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      setEndpoint(subscription?.endpoint ?? null);
      setDevice(subscription && settings.deviceEndpoints.includes(subscription.endpoint) ? 'on' : 'off');
    })().catch(() => setDevice('unsupported'));
  }, [settings.deviceEndpoints]);

  // Saving, subscribing and unsubscribing revalidate the page themselves. Only
  // `refresh` callers, whose action does not, ask for a re-read afterwards.
  function run(action: () => Promise<Result>, refresh = false) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success && refresh) router.refresh();
    });
  }

  function enableDevice() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return setMessage({ text: 'Push notifications aren’t available right now.', success: false });
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setDevice(permission === 'denied' ? 'blocked' : 'off');
        return { success: false, message: 'Notifications weren’t allowed. You can change this in your browser settings.' };
      }
      // register-sw.tsx registers the service worker on every load; this just waits for it.
      // `ready` never settles if no worker activates (not registered in dev, or a failed
      // install), so it is given a time limit rather than leaving the button spinning.
      const registration = await serviceWorkerReady(SERVICE_WORKER_TIMEOUT_MS);
      if (!registration) return { success: false, message: 'Notifications couldn’t start on this device. Reload the app and try again.' };
      const subscription = (await registration.pushManager.getSubscription())
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = subscription.toJSON();
      const result = await safeAction(subscribePushAction)({ endpoint: subscription.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '', userAgent: navigator.userAgent });
      if (result.success) {
        setEndpoint(subscription.endpoint);
        setDevice('on');
      }
      return result;
    });
  }

  function disableDevice() {
    run(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      const target = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      setDevice('off');
      return target ? safeAction(unsubscribePushAction)(target) : { success: true, message: 'Notifications turned off on this device.' };
    });
  }

  if (settings.state === 'setup') return <p className="fd-msg bad">Notifications aren’t available right now. Try again later.</p>;
  if (settings.state === 'unavailable') return <p className="fd-msg bad">Notification settings could not be loaded. Refresh and try again.</p>;

  const otherDevices = settings.deviceEndpoints.filter((item) => item !== endpoint).length;

  return (
    <div className="pf-notify">
      <label className="pf-master">
        <span><strong>Daily notifications</strong><small>Four short check-ins a day.</small></span>
        <input type="checkbox" role="switch" aria-label="Daily notifications" checked={prefs.enabled} onChange={(event) => setPrefs({ ...prefs, enabled: event.currentTarget.checked })} disabled={isPending} />
      </label>

      <div className={prefs.enabled ? 'pf-slots' : 'pf-slots muted'}>
        {NOTIFICATION_SLOTS.map((slot) => {
          const value = prefs.slots[slot.id];
          const off = !prefs.enabled || !value.enabled;
          return (
            <div className={off ? 'pf-slot off' : 'pf-slot'} key={slot.id}>
              <input type="checkbox" aria-label={`${slot.label} notification`} checked={value.enabled} onChange={(event) => setPrefs({ ...prefs, slots: { ...prefs.slots, [slot.id]: { ...value, enabled: event.currentTarget.checked } } })} disabled={isPending || !prefs.enabled} />
              <span><strong>{slot.label}</strong><small>{slot.hint}</small></span>
              <input type="time" aria-label={`${slot.label} time`} value={value.time} onChange={(event) => setPrefs({ ...prefs, slots: { ...prefs.slots, [slot.id]: { ...value, time: event.currentTarget.value } } })} disabled={isPending || off} />
            </div>
          );
        })}
      </div>
      <p className="fd-note tight">Times are in {timeZone.replaceAll('_', ' ')} (Settings → Region).</p>
      {dirty && <div className="fd-act"><button type="button" onClick={() => run(() => safeAction(saveNotificationPreferencesAction)(prefs))} disabled={isPending}>{isPending ? 'Saving…' : 'Save notification settings'}</button></div>}

      {nativeApp && <PhoneNotifications push={phonePush} run={run} isPending={isPending} />}

      {!nativeApp && <div className="pf-device">
        <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>This device</strong>
          <small>
            {device === 'checking' && 'Checking…'}
            {device === 'on' && `Notifications will arrive here.${otherDevicesNote(otherDevices)}`}
            {device === 'off' && `Not enabled on this device.${otherDevicesNote(settings.deviceEndpoints.length)}`}
            {device === 'blocked' && 'Blocked in your browser settings. Allow notifications for Orbis, then come back.'}
            {device === 'unsupported' && 'This browser doesn’t support push notifications.'}
            {device === 'ios-install' && 'On iPhone, tap Share → Add to Home Screen, open Orbis from there, then enable notifications.'}
          </small>
        </span>
        {device === 'off' && settings.pushConfigured && <button className="pf-pill primary" type="button" onClick={enableDevice} disabled={isPending}>{isPending ? <LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />} Enable</button>}
        {device === 'on' && <button className="pf-pill" type="button" onClick={disableDevice} disabled={isPending}><BellOff size={13} aria-hidden="true" /> Turn off</button>}
      </div>}
      {!nativeApp && device === 'on' && <button className="fd-link pf-test" type="button" onClick={() => run(() => safeAction(sendTestNotificationAction)(), true)} disabled={isPending}><Send size={13} aria-hidden="true" /> Send a test notification</button>}
      {!nativeApp && !settings.pushConfigured && <p className="fd-note tight">Push notifications aren’t available right now.</p>}
      {message && <output className={`fd-msg ${message.success ? 'ok' : 'bad'}`}>{message.text}</output>}
    </div>
  );
}

const NO_PUSH_IN_BUILD = 'Push isn’t set up in this build yet.';

/** What Android says about notifications for Orbis. */
async function phonePermission(ask: boolean): Promise<PhonePermission> {
  const plugin = await pushPlugin();
  const { receive } = ask ? await plugin.requestPermissions() : await plugin.checkPermissions();
  if (receive === 'granted') return 'granted';
  return receive === 'denied' ? 'denied' : 'prompt';
}

/**
 * The "This phone" row inside the Android app. Allowing notifications here is
 * also what shows the "Orbis is active" notification on Android 13 and later.
 * The push token itself reaches the phone through NativeBridge's listener.
 */
function PhoneNotifications({ push, run, isPending }: Readonly<{ push: 'unknown' | 'missing' | 'failed' | 'registered'; run: (action: () => Promise<Result>, refresh?: boolean) => void; isPending: boolean }>) {
  const [permission, setPermission] = useState<PhonePermission>('checking');

  // Read now, and again on every return: notifications may have been allowed in Android settings meanwhile.
  useEffect(() => {
    const check = () => { phonePermission(false).then(setPermission, () => setPermission('prompt')); };
    const onReturn = () => { if (document.visibilityState === 'visible') check(); };
    check();
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, []);

  function enable() {
    run(async () => {
      try {
        const answer = await phonePermission(true);
        setPermission(answer);
        if (answer !== 'granted') return { success: false, message: 'Notifications weren’t allowed. You can change this in Android settings.' };
        // Without Firebase in this build the push plugin's register() would crash the app.
        const { pushReady } = await OrbisCore.status();
        if (!pushReady) {
          // The row above now says push isn't set up; allowing still shows "Orbis is active".
          setPhoneLink({ push: 'missing' });
          return { success: true, message: 'Notifications are allowed on this phone.' };
        }
        await (await pushPlugin()).register();
        return { success: true, message: 'Notifications are on for this phone.' };
      } catch {
        return { success: false, message: 'Notifications couldn’t start on this phone. Try again.' };
      }
    });
  }

  const on = permission === 'granted' && push === 'registered';
  return (
    <>
      <div className="pf-device">
        <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>This phone</strong>
          <small>
            {permission === 'checking' && 'Checking…'}
            {permission === 'prompt' && 'Not enabled on this phone.'}
            {permission === 'denied' && 'Blocked in Android settings. Allow notifications for Orbis, then come back.'}
            {permission === 'granted' && push === 'missing' && NO_PUSH_IN_BUILD}
            {permission === 'granted' && push === 'failed' && 'Push couldn’t start on this phone. Try again later.'}
            {permission === 'granted' && push === 'unknown' && 'Connecting…'}
            {on && 'Notifications will arrive here.'}
          </small>
        </span>
        {permission === 'prompt' && <button className="pf-pill primary" type="button" onClick={enable} disabled={isPending}>{isPending ? <LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />} Enable</button>}
        {permission === 'denied' && <button className="pf-pill" type="button" onClick={() => { OrbisCore.openAppInfo().catch(() => undefined); }}><Settings2 size={13} aria-hidden="true" /> Settings</button>}
      </div>
      {on && <button className="fd-link pf-test" type="button" onClick={() => run(() => safeAction(sendTestNotificationAction)(), true)} disabled={isPending}><Send size={13} aria-hidden="true" /> Send a test notification</button>}
    </>
  );
}
