import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Where the WebView loads the site from. Plain http (cleartext) is allowed only when
 * ORBIS_URL itself is http://, i.e. a debug build pointed at a local dev server; the
 * hosted site is https and its builds never allow cleartext. See docs/ops/android.md.
 */
export function serverFor(url: string): NonNullable<CapacitorConfig['server']> {
  return { url, errorPath: 'offline.html', ...(url.startsWith('http://') ? { cleartext: true } : {}) };
}

// The Android app is a shell around the hosted site: the WebView loads
// server.url, so the UI ships through Vercel like the web app. native/www only
// holds the offline page Capacitor shows when that load fails.
const config: CapacitorConfig = {
  appId: 'app.orbis.android',
  appName: 'Orbis',
  webDir: 'native/www',
  server: serverFor(process.env.ORBIS_URL ?? 'https://orbis-starter.vercel.app'),
  android: { appendUserAgent: 'OrbisAndroid' },
  // Never log plugin calls: their arguments include the device secret (setDevice) and test text.
  loggingBehavior: 'none',
  plugins: {
    // A push that arrives while Orbis is open is shown too (by default it is only handed to the page).
    PushNotifications: { presentationOptions: ['alert', 'sound', 'badge'] },
  },
};

export default config;
