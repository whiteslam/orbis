import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orbis — Personal Intelligence',
  description: 'Finance, health, goals, habits and personal intelligence in one place.',
  applicationName: 'Orbis',
  appleWebApp: { capable: true, title: 'Orbis', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#f4f7fb',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
