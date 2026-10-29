import { describe, expect, it } from 'vitest';
import { MAX_ARGS, actionStatus, apiEnabled, bearerToken, readArgs, readCredentials, readRefreshToken } from './http';

const JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';

describe('apiEnabled', () => {
  it('is off unless ORBIS_API_ENABLED is exactly true', () => {
    expect(apiEnabled({})).toBe(false);
    expect(apiEnabled({ ORBIS_API_ENABLED: '1' })).toBe(false);
    expect(apiEnabled({ ORBIS_API_ENABLED: 'yes' })).toBe(false);
    expect(apiEnabled({ ORBIS_API_ENABLED: ' TRUE ' })).toBe(true);
  });
});

describe('bearerToken', () => {
  it('reads a JWT from a Bearer header', () => {
    expect(bearerToken(`Bearer ${JWT}`)).toBe(JWT);
    expect(bearerToken(`bearer   ${JWT}`)).toBe(JWT);
  });

  it('refuses anything that is not a single JWT', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(JWT)).toBeNull();
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerToken('Bearer not-a-jwt')).toBeNull();
    expect(bearerToken(`Bearer ${JWT} extra`)).toBeNull();
    expect(bearerToken(`Bearer ${'a'.repeat(4100)}.b.c`)).toBeNull();
  });
});

describe('readArgs', () => {
  it('treats an empty body or a missing args as no arguments', () => {
    expect(readArgs('')).toEqual([]);
    expect(readArgs('{}')).toEqual([]);
  });

  it('passes the args array through', () => {
    expect(readArgs('{"args": ["2026-10-01", {"x": 1}]}')).toEqual(['2026-10-01', { x: 1 }]);
  });

  it('explains a body it cannot use', () => {
    expect(readArgs('nope')).toBe('The body must be JSON.');
    expect(readArgs('[1]')).toMatch(/JSON object/);
    expect(readArgs('{"args": "x"}')).toMatch(/must be an array/);
    expect(readArgs(JSON.stringify({ args: Array(MAX_ARGS + 1).fill(0) }))).toMatch(/at most/);
  });
});

describe('actionStatus', () => {
  it('is 422 when the action refused', () => {
    expect(actionStatus({ success: false, message: 'Choose a tone.' })).toBe(422);
    expect(actionStatus({ error: 'Orbis is locked.' })).toBe(422);
  });

  it('is 200 otherwise', () => {
    expect(actionStatus({ success: true })).toBe(200);
    expect(actionStatus({ posts: [] })).toBe(200);
    expect(actionStatus({ error: null })).toBe(200);
    expect(actionStatus(undefined)).toBe(200);
  });
});

describe('readCredentials', () => {
  it('reads and normalises the email', () => {
    expect(readCredentials('{"email": " Me@Example.com ", "password": "pw"}')).toEqual({ email: 'me@example.com', password: 'pw' });
  });

  it('refuses a body without both', () => {
    expect(readCredentials('{"email": "me@example.com"}')).toBe('Send your email and password.');
    expect(readCredentials('x')).toMatch(/must be JSON/);
  });
});

describe('readRefreshToken', () => {
  it('reads refreshToken, or null', () => {
    expect(readRefreshToken('{"refreshToken": "abc"}')).toBe('abc');
    expect(readRefreshToken('{"refreshToken": 5}')).toBeNull();
    expect(readRefreshToken('x')).toBeNull();
  });
});
