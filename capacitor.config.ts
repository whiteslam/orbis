import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a shell around the hosted site: the WebView loads
// server.url, so the UI ships through Vercel like the web app. native/www only
// holds the offline page Capacitor shows when that load fails.
const config: CapacitorConfig = {
  appId: 'app.orbis.android',
  appName: 'Orbis',
  webDir: 'native/www',
  server: {
    url: process.env.ORBIS_URL ?? 'https://orbis-starter.vercel.app',
    errorPath: 'offline.html',
  },
  android: { appendUserAgent: 'OrbisAndroid' },
};

export default config;
