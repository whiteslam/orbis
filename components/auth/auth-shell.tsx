import type { ReactNode } from 'react';
import { OrbisMark } from '@/components/brand/orbis-mark';

// The Atlas sign-in ground: one column on the Field gradient.
// `centered` is the lock and PIN layout (no brand row, centred column); `footer` sits at the bottom of the column.
export function AuthShell({ children, centered = false, footer }: { children: ReactNode; centered?: boolean; footer?: ReactNode }) {
  return (
    <main className="auth-stage">
      <section className={centered ? 'auth-card centered' : 'auth-card'}>
        {!centered && (
          <div className="auth-brand">
            <OrbisMark size={40} />
            <strong>Orbis</strong>
          </div>
        )}
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </section>
    </main>
  );
}
