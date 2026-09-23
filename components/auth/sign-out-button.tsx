import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="icon-btn" type="submit" aria-label="Sign out" title="Sign out">
        <LogOut size={18} />
      </button>
    </form>
  );
}
