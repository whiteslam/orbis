// What a person may do beyond the ordinary. Pure, so tests can import it without a database.

export type Role = 'owner' | 'admin' | 'user';

const ROLES: readonly Role[] = ['owner', 'admin', 'user'];

/** Anything that is not a known role is an ordinary user. */
export function parseRole(value: unknown): Role {
  return ROLES.find((role) => role === value) ?? 'user';
}
