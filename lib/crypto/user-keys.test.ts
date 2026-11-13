import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { PhoneDataCryptoError, decryptForUser, encryptForUser, phoneDataReady } = await import('@/lib/crypto/user-keys');

const KEY = Buffer.alloc(32, 7).toString('base64');
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const signalId = 'signal-1';

describe('per-user phone data encryption', () => {
  beforeEach(() => {
    vi.stubEnv('ORBIS_PHONE_DATA_KEY', KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips text in a p1 envelope', () => {
    const envelope = encryptForUser(userId, 'Mum called about the flat', signalId);
    expect(envelope).toMatch(/^p1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(envelope).not.toContain('Mum');
    expect(decryptForUser(userId, envelope, signalId)).toBe('Mum called about the flat');
  });

  it('round-trips multi-byte text', () => {
    const text = 'नमस्ते 👋 café';
    expect(decryptForUser(userId, encryptForUser(userId, text, signalId), signalId)).toBe(text);
  });

  it('gives a different envelope each time for the same text', () => {
    expect(encryptForUser(userId, 'same', signalId)).not.toBe(encryptForUser(userId, 'same', signalId));
  });

  it('refuses to decrypt for another user', () => {
    const envelope = encryptForUser(userId, 'private', signalId);
    expect(() => decryptForUser(otherUserId, envelope, signalId)).toThrow(PhoneDataCryptoError);
  });

  it('refuses to decrypt under another context', () => {
    const envelope = encryptForUser(userId, 'private', signalId);
    expect(() => decryptForUser(userId, envelope, 'signal-2')).toThrow(PhoneDataCryptoError);
  });

  it('refuses a tampered envelope', () => {
    const envelope = encryptForUser(userId, 'private', signalId);
    const last = envelope.slice(-1);
    const tampered = envelope.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(() => decryptForUser(userId, tampered, signalId)).toThrow(PhoneDataCryptoError);
  });

  it('refuses malformed envelopes', () => {
    for (const bad of ['', 'p1', 'v1.a.b.c', 'p1.a.b', 'p1.a.b.c.d', 'p1.!.!.!']) {
      expect(() => decryptForUser(userId, bad, signalId)).toThrow(PhoneDataCryptoError);
    }
  });

  it('refuses empty text', () => {
    expect(() => encryptForUser(userId, '', signalId)).toThrow(PhoneDataCryptoError);
  });

  it('reports ready only with a 32-byte base64 key', () => {
    expect(phoneDataReady()).toBe(true);
  });

  it('is not ready and refuses to encrypt when the key is unset', () => {
    vi.stubEnv('ORBIS_PHONE_DATA_KEY', '');
    expect(phoneDataReady()).toBe(false);
    expect(() => encryptForUser(userId, 'x', signalId)).toThrow(PhoneDataCryptoError);
  });

  it('is not ready and refuses to encrypt when the key is 16 bytes', () => {
    vi.stubEnv('ORBIS_PHONE_DATA_KEY', Buffer.alloc(16, 7).toString('base64'));
    expect(phoneDataReady()).toBe(false);
    expect(() => encryptForUser(userId, 'x', signalId)).toThrow(PhoneDataCryptoError);
  });

  it('checks a passed environment instead of process.env', () => {
    expect(phoneDataReady({ ORBIS_PHONE_DATA_KEY: Buffer.alloc(16).toString('base64') })).toBe(false);
    expect(phoneDataReady({})).toBe(false);
    expect(phoneDataReady({ ORBIS_PHONE_DATA_KEY: KEY })).toBe(true);
  });
});
