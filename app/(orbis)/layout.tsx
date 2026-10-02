// Everything behind the front door: the app itself and the pages that let you in.
//
// This layout exists for one reason — to own the app's stylesheets. A route group
// changes no URL, so /active, /login, /forgot-password and /reset-password are
// exactly where they were; what changes is that their CSS no longer ships to the
// public waitlist. See the note in app/layout.tsx.
import '../styles/02-home.css';
import '../styles/03-hero.css';
import '../styles/04-views.css';
import '../styles/05-profile.css';
import '../styles/06-finance.css';
import '../styles/07-auth.css';
import '../styles/08-month.css';
import '../styles/10-assistant.css';
import '../styles/atlas-health.css';
import '../styles/atlas-profile.css';
import '../styles/atlas-social.css';
import '../styles/settings.css';
import '../styles/glass.css';
import '../styles/glass-dark.css';
import '../styles/headsups.css';
import '../styles/motion.css';

export default function OrbisLayout({ children }: { children: React.ReactNode }) {
  return children;
}
