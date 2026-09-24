import type { Metadata, Viewport } from 'next';
import './globals.css';
import { KeyboardAware } from '@/components/mobile/keyboard-aware';

export const metadata: Metadata = {
  title: 'Orbis — Personal Intelligence',
  description: 'Finance, health, goals, habits and personal intelligence in one place.',
  applicationName: 'Orbis',
  appleWebApp: { capable: true, title: 'Orbis', statusBarStyle: 'default' },
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored appearance before first paint so the page never
            flashes the wrong theme. Inline and synchronous by necessity. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('orbis-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <KeyboardAware />
        {children}
      </body>
    </html>
  );
}
