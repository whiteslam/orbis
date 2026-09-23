import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orbis — Personal Intelligence',
  description: 'Finance, health, goals, habits and personal intelligence in one place.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
