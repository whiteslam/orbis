import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getGmailConfig } from '@/lib/gmail/config';

const VERSION = 'v1';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function decodePart(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Stored Gmail credentials are invalid.');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Stored Gmail credentials are invalid.');
  return decoded;
}

export function encryptRefreshToken(token: string) {
  if (!token) throw new Error('Cannot encrypt an empty Gmail token.');

  const { tokenEncryptionKey } = getGmailConfig();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, nonce.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptRefreshToken(envelope: string) {
  const [version, encodedNonce, encodedTag, encodedCiphertext, extra] = envelope.split('.');
  if (version !== VERSION || !encodedNonce || !encodedTag || !encodedCiphertext || extra) {
    throw new Error('Stored Gmail credentials are invalid.');
  }

  const nonce = decodePart(encodedNonce);
  const authTag = decodePart(encodedTag);
  const ciphertext = decodePart(encodedCiphertext);
  if (nonce.length !== NONCE_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) {
    throw new Error('Stored Gmail credentials are invalid.');
  }

  const { tokenEncryptionKey } = getGmailConfig();
  try {
    const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored Gmail credentials could not be unlocked. Check the server configuration.');
  }
}
