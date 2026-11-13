import 'server-only';

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Per-user AES-256-GCM envelope for phone data (signal content) stored in the
// database. One master key, ORBIS_PHONE_DATA_KEY, is expanded with HKDF into a
// separate key for every user, and each value is bound to its user and to a
// context (the signal's id) as additional authenticated data, so an envelope
// cannot be unlocked for another user or moved to another row.
const VERSION = 'p1';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HKDF_SALT = 'orbis-phone-data-v1';

export class PhoneDataCryptoError extends Error {}

function masterKey(env: Record<string, string | undefined>) {
  const encoded = env.ORBIS_PHONE_DATA_KEY?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new PhoneDataCryptoError('Phone data storage is not configured. Set ORBIS_PHONE_DATA_KEY on the server.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new PhoneDataCryptoError('The phone data key must be 32 bytes, base64-encoded.');
  return key;
}

export function phoneDataReady(env: Record<string, string | undefined> = process.env) {
  try {
    masterKey(env);
    return true;
  } catch {
    return false;
  }
}

function userKey(userId: string) {
  if (!userId) throw new PhoneDataCryptoError('Phone data needs a user.');
  return Buffer.from(hkdfSync('sha256', masterKey(process.env), HKDF_SALT, `user:${userId}`, 32));
}

function aad(userId: string, context: string) {
  return Buffer.from(`${userId}\n${context}`, 'utf8');
}

function decodePart(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new PhoneDataCryptoError('Stored phone data is invalid.');
  const bytes = Buffer.from(value, 'base64url');
  // Reject non-canonical encodings: the last character can carry unused bits,
  // so two different strings could otherwise decode to the same bytes.
  if (bytes.toString('base64url') !== value) throw new PhoneDataCryptoError('Stored phone data is invalid.');
  return bytes;
}

export function encryptForUser(userId: string, plaintext: string, context: string) {
  if (!plaintext) throw new PhoneDataCryptoError('Cannot encrypt empty phone data.');
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', userKey(userId), nonce);
  cipher.setAAD(aad(userId, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptForUser(userId: string, envelope: string, context: string) {
  const [version, encodedNonce, encodedTag, encodedCiphertext, extra] = envelope.split('.');
  if (version !== VERSION || !encodedNonce || !encodedTag || !encodedCiphertext || extra) throw new PhoneDataCryptoError('Stored phone data is invalid.');
  const nonce = decodePart(encodedNonce);
  const authTag = decodePart(encodedTag);
  const ciphertext = decodePart(encodedCiphertext);
  if (nonce.length !== NONCE_LENGTH || authTag.length !== AUTH_TAG_LENGTH || !ciphertext.length) throw new PhoneDataCryptoError('Stored phone data is invalid.');
  const key = userKey(userId);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(userId, context));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new PhoneDataCryptoError('Stored phone data could not be unlocked. Check the server encryption key.');
  }
}
