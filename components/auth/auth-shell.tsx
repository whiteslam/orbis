import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-stage">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="logo-mark">O</div>
          <div><strong>Orbis</strong><span>Your personal intelligence system</span></div>
        </div>
        {children}
      </section>
    </main>
  );
}
