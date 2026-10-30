import type { ReactNode } from 'react';
import { OrbisMark } from '@/components/brand/orbis-mark';

// The sign-in ground: one column on the Field, led by the Orbis ring.
// On a wide screen the ring gets its own half of the page, set big beside the
// form, so the first thing a returning visitor sees is the brand and the one
// thing to do. On a phone it is just the mark above the form.
// `centered` is the lock and PIN layout (no brand row, centred column); `footer` sits at the bottom of the column.
export function AuthShell({ children, centered = false, footer }: Readonly<{ children: ReactNode; centered?: boolean; footer?: ReactNode }>) {
  if (centered) {
    return (
      <main className="auth-stage auth-lock">
        <section className="auth-card centered">
          {children}
          {footer && <div className="auth-foot">{footer}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="auth-stage auth-split">
      <div className="auth-side">
        <div className="auth-brand">
          <OrbisMark size={40} />
          <strong>Orbis</strong>
        </div>
        <div className="auth-orbit" aria-hidden="true">
          <OrbisMark size={260} className="auth-ring" />
        </div>
        <p className="auth-line">Everything you keep track of, in one calm page.</p>
      </div>
      <section className="auth-card">
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </section>
    </main>
  );
}
