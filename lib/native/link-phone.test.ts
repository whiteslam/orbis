import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { CoreStatus } from './orbis-core';

const ME = '7f1c2d3e-0000-4000-8000-000000000001';
const SOMEONE_ELSE = '7f1c2d3e-0000-4000-8000-000000000002';

const core = vi.hoisted(() => ({
  status: vi.fn(),
  signOut: vi.fn(),
  setDevice: vi.fn(),
}));
const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  register: vi.fn(),
}));

vi.mock('./orbis-core', () => ({ OrbisCore: core, isNativeApp: () => true }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));

function status(over: Partial<CoreStatus> = {}): CoreStatus {
  return {
    registered: true, userId: ME, deviceId: 'd1', distribution: 'play', model: 'Pixel 8', manufacturer: 'Google', appVersion: '1.0.0',
    sources: {} as CoreStatus['sources'], pausedUntil: null, pendingSignals: 0, lastSyncAt: null, lastSyncError: null,
    batteryOptimized: false, webAuthn: true, pushReady: true, signedOutReason: null, ...over,
  };
}

const created = () => new Response(JSON.stringify({ deviceId: 'd2', secret: 's'.repeat(43) }), { status: 201 });

// Fresh module state (the store, the in-flight run, the backoff) for every test.
async function load() {
  vi.resetModules();
  const link = await import('./link-phone');
  const state = await import('./device-state');
  return { ...link, ...state };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => created());
  vi.stubGlobal('fetch', fetchMock);
  core.signOut.mockResolvedValue(undefined);
  core.setDevice.mockResolvedValue(undefined);
  push.checkPermissions.mockResolvedValue({ receive: 'granted' });
  push.register.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

test('after another account is replaced, push is asked for again even though it was registered', async () => {
  const m = await load();
  m.setPhoneLink({ push: 'registered', registerError: { status: 409, message: 'old' }, removed: true });
  core.status.mockResolvedValue(status({ userId: SOMEONE_ELSE }));
  await m.linkThisPhone(ME);
  assert.equal(core.signOut.mock.calls.length, 1);
  assert.deepEqual(core.signOut.mock.calls[0][0], { revoke: true });
  assert.equal(core.setDevice.mock.calls.length, 1);
  assert.equal(push.register.mock.calls.length, 1, 'the wiped token is fetched again');
  assert.deepEqual(m.getPhoneLink(), { registerError: null, removed: false, push: 'unknown' });
});

test('a phone already linked to this person with push registered is left alone', async () => {
  const m = await load();
  m.setPhoneLink({ push: 'registered' });
  core.status.mockResolvedValue(status());
  await m.linkThisPhone(ME);
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(push.register.mock.calls.length, 0);
});

test('nothing is registered while signing out', async () => {
  const m = await load();
  m.setSigningOut(true);
  core.status.mockResolvedValue(status({ registered: false, userId: null }));
  await m.linkThisPhone(ME, { resume: true });
  assert.equal(core.status.mock.calls.length, 0);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('"again" during a run is not dropped: it runs once the first one ends', async () => {
  const m = await load();
  let release: (value: CoreStatus) => void = () => {};
  core.status.mockImplementationOnce(() => new Promise<CoreStatus>((resolve) => { release = resolve; }));
  core.status.mockResolvedValue(status({ registered: false, userId: null, signedOutReason: 'revoked' }));
  const first = m.linkThisPhone(ME);
  const again = m.linkThisPhone(ME, { again: true });
  release(status({ registered: false, userId: null, signedOutReason: 'revoked' }));
  await first;
  assert.equal(fetchMock.mock.calls.length, 0, 'the first run leaves a removed phone alone');
  assert.equal(m.getPhoneLink().removed, true);
  await again;
  assert.equal(core.status.mock.calls.length, 2);
  assert.equal(fetchMock.mock.calls.length, 1, 'the follow-up adds it back');
  assert.equal(core.setDevice.mock.calls.length, 1);
  assert.equal(m.getPhoneLink().removed, false);
});

test('a phone service that can’t be reached settles with a message instead of hanging', async () => {
  const m = await load();
  core.status.mockRejectedValue(Object.assign(new Error('x'), { code: 'store_unavailable' }));
  await m.linkThisPhone(ME);
  const link = m.getPhoneLink();
  assert.deepEqual(link.registerError, { status: 0, message: 'Couldn’t reach this phone’s Orbis service. Try again.' });
  assert.equal(link.push, 'failed');
});

test('a failed reset settles the same way, without registering', async () => {
  const m = await load();
  core.status.mockResolvedValue(status({ userId: SOMEONE_ELSE }));
  core.signOut.mockRejectedValue(new Error('store_unavailable'));
  await m.linkThisPhone(ME);
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(m.getPhoneLink().registerError?.status, 0);
  assert.equal(m.getPhoneLink().push, 'failed');
});

test('after an unreachable service, a return to the app waits before trying the reset again', async () => {
  const m = await load();
  core.status.mockResolvedValue(status({ userId: SOMEONE_ELSE }));
  core.signOut.mockRejectedValueOnce(new Error('store_unavailable'));
  await m.linkThisPhone(ME);
  await m.linkThisPhone(ME, { resume: true });
  assert.equal(core.signOut.mock.calls.length, 1, 'backed off');
});

test('once the phone answers again and is already linked, the old "couldn’t reach" error and its backoff are cleared', async () => {
  const m = await load();
  core.status.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'store_unavailable' }));
  await m.linkThisPhone(ME);
  assert.equal(m.getPhoneLink().registerError?.status, 0);

  core.status.mockResolvedValue(status());
  await m.linkThisPhone(ME, { resume: true });
  assert.equal(m.getPhoneLink().registerError, null, 'the stale message is gone');

  // The backoff went with it: a later change of account is handled on the next return, not 10 minutes on.
  core.status.mockResolvedValue(status({ userId: SOMEONE_ELSE }));
  await m.linkThisPhone(ME, { resume: true });
  assert.equal(core.signOut.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls.length, 1);
});
