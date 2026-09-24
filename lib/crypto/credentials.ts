import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM envelope for third-party credentials stored in the database
// (e.g. Groww API keys). Uses CREDENTIAL_ENCRYPTION_KEY, falling back to the
// existing GMAIL_TOKEN_ENCRYPTION_KEY so no new secret is required.
const VERSION = 'v1';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class CredentialCryptoError extends Error {}

function encryptionKey() {
  const encoded = (process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY)?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new CredentialCryptoError('Secure storage is not configured. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY) on the server.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new CredentialCryptoError('The server encryption key must be 32 bytes, base64-encoded.');
  return key;
}

export function credentialEncryptionReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function decodePart(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new CredentialCryptoError('Stored credentials are invalid.');
  return Buffer.from(value, 'base64url');
}

export function encryptCredential(value: string) {
  if (!value) throw new CredentialCryptoError('Cannot encrypt an empty credential.');
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [VERSION, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptCredential(envelope: string) {
  const [version, encodedNonce, encodedTag, encodedCiphertext, extra] = envelope.split('.');
  if (version !== VERSION || !encodedNonce || !encodedTag || !encodedCiphertext || extra) throw new CredentialCryptoError('Stored credentials are invalid.');
  const nonce = decodePart(encodedNonce);
  const authTag = decodePart(encodedTag);
  const ciphertext = decodePart(encodedCiphertext);
  if (nonce.length !== NONCE_LENGTH || authTag.length !== AUTH_TAG_LENGTH || !ciphertext.length) throw new CredentialCryptoError('Stored credentials are invalid.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialCryptoError('Stored credentials could not be unlocked. Check the server encryption key.');
  }
}
