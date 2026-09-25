import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';

// `text` renders a plain "Sign out" link-style button (lock and PIN screens) instead of the top-bar icon.
export function SignOutButton({ variant = 'icon' }: { variant?: 'icon' | 'text' }) {
  return (
    <form action={signOut}>
      {variant === 'text' ? (
        <button className="auth-signout" type="submit">Sign out</button>
      ) : (
        <button className="icon-btn" type="submit" aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      )}
    </form>
  );
}
