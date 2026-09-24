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
  themeColor: '#f4f7fb',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <KeyboardAware />
        {children}
      </body>
    </html>
  );
}
