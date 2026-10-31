import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
// Only the stylesheets the public pages use. The app's own live in
// app/(orbis)/layout.tsx, because a stylesheet is a description: the app's
// sheets carry selectors like .groww-card, .gmail-review-merchant and
// .journal-row, and loading them here meant anyone could open the Network tab
// on the waitlist and read off every service Orbis connects to. It also cost a
// stranger 153 KB of CSS for a page with one form on it.
import './styles/01-base.css';
import './styles/09-boundaries.css';
import './styles/marketing.css';
import './styles/brand.css';
import './styles/page-public.css';
import { KeyboardAware } from '@/components/mobile/keyboard-aware';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { SITE_NAME, siteUrl } from '@/lib/site';

const DESCRIPTION = 'One calm daily brief for your money, health and routines — read-only connections, private by default, and AI that never trains on your personal data.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — Personal Intelligence`, template: `%s — ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'default' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Personal Intelligence`,
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Personal Intelligence`,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Draw under the notch and home indicator; the CSS pads with env(safe-area-inset-*).
  viewportFit: 'cover',
  // Android resizes the layout around the on-screen keyboard instead of covering it.
  interactiveWidget: 'resizes-content',
  themeColor: '#0e0e10',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Set by proxy.ts; the Content-Security-Policy only runs inline scripts carrying it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the appearance before first paint so the page never flashes
            the wrong theme: the one chosen with the theme button if there is
            one, otherwise the device's, followed live as the device changes
            (Apple asks apps to follow the system appearance). Inline and
            synchronous by necessity. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement,q=matchMedia('(prefers-color-scheme: light)'),s=function(){var t=localStorage.getItem('orbis-theme');d.dataset.theme=t==='dark'||t==='light'?t:q.matches?'light':'dark'};s();q.addEventListener('change',s)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <KeyboardAware />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
