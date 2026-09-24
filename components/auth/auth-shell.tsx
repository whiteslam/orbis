import type { ReactNode } from 'react';
import { OrbisMark } from '@/components/brand/orbis-mark';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-stage">
      <section className="auth-card">
        <div className="auth-brand">
          <OrbisMark />
          <div><strong>Orbis</strong><span>Your personal intelligence system</span></div>
        </div>
        {children}
      </section>
    </main>
  );
}
