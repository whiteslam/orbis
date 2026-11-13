// The Social Studio's pure rules: who may use which account, how a post is
// titled from its caption, and how a month's posts are grouped on the page.
// Relative imports, so the unit tests can load this module under plain Node.
import type { Role } from '../security/role.ts';
import type { SocialAccount } from './types.ts';

/** Orbis's own promotion page belongs to the owner alone. */
export function accountAllowed(account: SocialAccount, role: Role): boolean {
  return account === 'me' || role === 'owner';
}
