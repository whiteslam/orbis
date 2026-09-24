import type { ReactNode } from 'react';
import { OrbisMark } from '@/components/brand/orbis-mark';

// `centered` lays the card out as one centred column (lock and PIN screens).
export function AuthShell({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  return (
    <main className="auth-stage">
      <section className={centered ? 'auth-card centered' : 'auth-card'}>
        <div className="auth-brand">
          <OrbisMark />
          <div><strong>Orbis</strong><span>Your personal intelligence system</span></div>
        </div>
        {children}
      </section>
    </main>
  );
}
