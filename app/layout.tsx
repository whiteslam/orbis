import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './styles/01-base.css';
import './styles/02-home.css';
import './styles/03-hero.css';
import './styles/04-views.css';
import './styles/05-profile.css';
import './styles/06-finance.css';
import './styles/07-auth.css';
import './styles/08-month.css';
import './styles/09-boundaries.css';
import './styles/10-assistant.css';
import './styles/atlas-health.css';
import './styles/atlas-profile.css';
import './styles/atlas-social.css';
import './styles/marketing.css';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Set by proxy.ts; the Content-Security-Policy only runs inline scripts carrying it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
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
