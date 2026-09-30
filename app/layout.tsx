import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Figtree } from 'next/font/google';
// Only the stylesheets the public pages use. The app's own live in
// app/(orbis)/layout.tsx, because a stylesheet is a description: the app's
// sheets carry selectors like .groww-card, .gmail-review-merchant and
// .journal-row, and loading them here meant anyone could open the Network tab
// on the waitlist and read off every service Orbis connects to. It also cost a
// stranger 153 KB of CSS for a page with one form on it.
import './styles/01-base.css';
import './styles/09-boundaries.css';
import './styles/marketing.css';
import { KeyboardAware } from '@/components/mobile/keyboard-aware';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { SITE_NAME, siteUrl } from '@/lib/site';

const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-figtree', display: 'swap' });

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Set by proxy.ts; the Content-Security-Policy only runs inline scripts carrying it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <head>
        {/* Applies the stored appearance before first paint so the page never
            flashes the wrong theme. Inline and synchronous by necessity. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('orbis-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}`,
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
