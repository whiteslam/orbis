import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export { isPinFormat, MAX_PIN_ATTEMPTS, PIN_LENGTH, pinProblem } from './pin-rules.ts';

// PIN hashing (scrypt, random salt). No Next.js imports, so it can be unit tested with node:test.

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const expected = Buffer.from(hashText, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(pin, Buffer.from(saltText, 'base64url'), KEY_LENGTH, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}
