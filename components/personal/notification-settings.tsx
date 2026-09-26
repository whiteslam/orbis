'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, LoaderCircle, Send, Smartphone } from 'lucide-react';
import { saveNotificationPreferencesAction, sendTestNotificationAction, subscribePushAction, unsubscribePushAction } from '@/app/personal/notification-actions';
import { NOTIFICATION_SLOTS, type NotificationPreferences, type NotificationSettings as Settings } from '@/lib/notifications/preferences';
import { safeAction } from '@/lib/client/safe-action';

type DeviceState = 'checking' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function isIosBrowserTab() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export function NotificationSettings({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences>(settings.preferences);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = JSON.stringify(prefs) !== JSON.stringify(settings.preferences);

  useEffect(() => {
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

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function enableDevice() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return setMessage({ text: 'Push isn’t configured on the server yet (VAPID keys).', success: false });
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setDevice(permission === 'denied' ? 'blocked' : 'off');
        return { success: false, message: 'Notifications weren’t allowed. You can change this in your browser settings.' };
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
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

  if (settings.state === 'setup') return <p className="fd-msg bad">Apply the profile/journal/notifications migration in Supabase to manage notifications.</p>;
  if (settings.state === 'unavailable') return <p className="fd-msg bad">Notification settings could not be loaded. Refresh and try again.</p>;

  const otherDevices = settings.deviceEndpoints.filter((item) => item !== endpoint).length;

  return (
    <div className="pf-notify">
      <label className="pf-master">
        <span><strong>Daily notifications</strong><small>Four short check-ins a day, written from your own data.</small></span>
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
      <p className="fd-note tight">Times are in {prefs.timezone.replace('_', ' ')}.</p>
      {dirty && <div className="fd-act"><button type="button" onClick={() => run(() => safeAction(saveNotificationPreferencesAction)(prefs))} disabled={isPending}>{isPending ? 'Saving…' : 'Save notification settings'}</button></div>}

      <div className="pf-device">
        <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>This device</strong>
          <small>
            {device === 'checking' && 'Checking…'}
            {device === 'on' && `Notifications will arrive here.${otherDevices ? ` On for ${otherDevices} other device${otherDevices === 1 ? '' : 's'}.` : ''}`}
            {device === 'off' && `Not enabled on this device.${settings.deviceEndpoints.length ? ` On for ${settings.deviceEndpoints.length} other device${settings.deviceEndpoints.length === 1 ? '' : 's'}.` : ''}`}
            {device === 'blocked' && 'Blocked in your browser settings. Allow notifications for Orbis, then come back.'}
            {device === 'unsupported' && 'This browser doesn’t support push notifications.'}
            {device === 'ios-install' && 'On iPhone, tap Share → Add to Home Screen, open Orbis from there, then enable notifications.'}
          </small>
        </span>
        {device === 'off' && settings.pushConfigured && <button className="pf-pill primary" type="button" onClick={enableDevice} disabled={isPending}>{isPending ? <LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />} Enable</button>}
        {device === 'on' && <button className="pf-pill" type="button" onClick={disableDevice} disabled={isPending}><BellOff size={13} aria-hidden="true" /> Turn off</button>}
      </div>
      {device === 'on' && <button className="fd-link pf-test" type="button" onClick={() => run(() => safeAction(sendTestNotificationAction)())} disabled={isPending}><Send size={13} aria-hidden="true" /> Send a test notification</button>}
      {!settings.pushConfigured && <p className="fd-note tight">Push keys aren’t set on the server yet (NEXT_PUBLIC_VAPID_PUBLIC_KEY).</p>}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
