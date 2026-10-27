import Link from 'next/link';

/**
 * The full web panel at /active/career. A placeholder until the panel lands:
 * Overview, Pipeline, Jobs, Interviews, Offers, Insights and Setup
 * (docs/superpowers/specs/2026-10-27-career-copilot-design.md, "The web panel").
 * The page has already checked the session, the allowlist, the lock and the PIN.
 */
export function CareerPanel({ email }: Readonly<{ email: string | null }>) {
  return (
    <main className="cp-panel">
      <header className="cp-header">
        <h1>Career</h1>
        {email && <p className="cp-who">{email}</p>}
      </header>
      <Link href="/active#career">Back to the app</Link>
    </main>
  );
}
