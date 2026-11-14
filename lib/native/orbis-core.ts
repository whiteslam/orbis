// The page's way into the Android app's on-phone core (the OrbisCore Capacitor
// plugin, android/app/src/main/java/app/orbis/android/OrbisCorePlugin.kt).
//
// Client-only and safe to import anywhere: outside the Android app
// isNativeApp() is false and every call rejects with Capacitor's
// "not implemented" error, so callers check isNativeApp() first.
//
// Every call rejects with code 'not_orbis_origin' unless the WebView is on the
// Orbis site itself ('unsupported_webview' on a WebView too old to keep other
// frames out of the bridge), and with a short code (never a message meant for people)
// when the phone's store can't be read: 'store_unavailable'. Other codes:
// 'invalid_credential', 'invalid_source', 'invalid_until', 'invalid_privacy',
// 'invalid_text', 'invalid_token', 'invalid_limit', 'no_activity'.

import { Capacitor, registerPlugin } from '@capacitor/core';
// Type-only: lib/device/http.ts imports node:crypto and must never reach a client bundle.
import type { Source } from '@/lib/device/http';

/**
 * `pausedUntil` everywhere in this module: null = not paused, -1 = paused until
 * turned back on, otherwise epoch milliseconds.
 */
export const PAUSED_FOREVER = -1;

export type CoreStatus = {
  registered: boolean;
  userId: string | null;
  deviceId: string | null;
  distribution: 'play' | 'direct';
  model: string;
  manufacturer: string;
  appVersion: string;
  sources: Record<Source, boolean>;
  pausedUntil: number | null;
  pendingSignals: number;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  batteryOptimized: boolean;
  webAuthn: boolean;
  /** False when this build has no Firebase config: PushNotifications.register() would crash the app, so never call it then. */
  pushReady: boolean;
  signedOutReason: 'revoked' | null;
};

export type Privacy = {
  sources: Record<Source, boolean>;
  blockedPackages: string[];
  blockedContacts: string[];
  blockedKeywords: string[];
  pausedUntil: number | null;
};

export type PrivacyLists = {
  blockedPackages?: string[];
  blockedContacts?: string[];
  blockedKeywords?: string[];
};

export type TestCaptureResult = {
  decision: 'kept' | 'dropped';
  /** Why it was dropped: OTHER_PROFILE, PAUSED, SOURCE_OFF, BLOCKED_APP, BLOCKED_CONTACT or BLOCKED_KEYWORD. */
  reason?: string;
  /** The text as it was kept, after masking. */
  masked?: string;
};

export type LauncherApp = { packageName: string; label: string };

export type ActivityEntry = { at: number; source: string; decision: string; reason?: string };

/** What the native plugin itself answers (Capacitor resolves objects, never bare arrays). */
interface OrbisCoreNative {
  status(): Promise<CoreStatus>;
  setDevice(options: { deviceId: string; secret: string; userId: string }): Promise<void>;
  signOut(options: { revoke: boolean }): Promise<void>;
  getPrivacy(): Promise<Privacy>;
  setPrivacy(options: PrivacyLists): Promise<void>;
  setSource(options: { source: Source; enabled: boolean }): Promise<CoreStatus>;
  pause(options: { until: number }): Promise<CoreStatus>;
  testCapture(options: { app?: string; contact?: string; text: string }): Promise<TestCaptureResult>;
  listApps(): Promise<{ apps: LauncherApp[] }>;
  recentActivity(options: { limit: number }): Promise<{ entries: ActivityEntry[] }>;
  setPushToken(options: { token: string }): Promise<void>;
  openBatterySettings(): Promise<void>;
  openAppInfo(): Promise<void>;
  notificationAccess(): Promise<{ granted: boolean }>;
  openNotificationAccess(): Promise<void>;
}

export interface OrbisCorePlugin {
  status(): Promise<CoreStatus>;
  /** Saves this phone's credential (the server URL is the app's own, never the page's), then starts syncing. */
  setDevice(options: { deviceId: string; secret: string; userId: string }): Promise<void>;
  /** Wipes everything on the phone; with revoke, first tells the server (best effort, 5 s). */
  signOut(options: { revoke: boolean }): Promise<void>;
  getPrivacy(): Promise<Privacy>;
  /** Replaces each list that is given; the others stay. Contacts are matched by their last 10 digits. */
  setPrivacy(options: PrivacyLists): Promise<void>;
  setSource(options: { source: Source; enabled: boolean }): Promise<CoreStatus>;
  /** `until`: 0 resumes, -1 pauses until turned back on, otherwise epoch milliseconds. */
  pause(options: { until: number }): Promise<CoreStatus>;
  /** Runs a made-up item from the test source through the privacy rules. Never echoes the raw text. */
  testCapture(options: { app?: string; contact?: string; text: string }): Promise<TestCaptureResult>;
  /** Apps with a launcher icon, sorted by label. */
  listApps(): Promise<LauncherApp[]>;
  /** The newest decisions, newest first: time, source, decision and reason only. */
  recentActivity(options: { limit: number }): Promise<ActivityEntry[]>;
  setPushToken(options: { token: string }): Promise<void>;
  openBatterySettings(): Promise<void>;
  openAppInfo(): Promise<void>;
  /** Whether Android has given Orbis notification access (the Notifications source reads nothing without it). */
  notificationAccess(): Promise<{ granted: boolean }>;
  /** Opens Android's Notification access screen, where the person gives it. */
  openNotificationAccess(): Promise<void>;
}

const native = registerPlugin<OrbisCoreNative>('OrbisCore');

/** True inside the Android app. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export const OrbisCore: OrbisCorePlugin = {
  status: () => native.status(),
  setDevice: (options) => native.setDevice(options),
  signOut: (options) => native.signOut(options),
  getPrivacy: () => native.getPrivacy(),
  setPrivacy: (options) => native.setPrivacy(options),
  setSource: (options) => native.setSource(options),
  pause: (options) => native.pause(options),
  testCapture: (options) => native.testCapture(options),
  listApps: async () => (await native.listApps()).apps,
  recentActivity: async (options) => (await native.recentActivity(options)).entries,
  setPushToken: (options) => native.setPushToken(options),
  openBatterySettings: () => native.openBatterySettings(),
  openAppInfo: () => native.openAppInfo(),
  notificationAccess: () => native.notificationAccess(),
  openNotificationAccess: () => native.openNotificationAccess(),
};
