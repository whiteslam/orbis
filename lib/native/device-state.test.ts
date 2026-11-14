import { test } from 'vitest';
import assert from 'node:assert/strict';
import { getPhoneLink, isSigningOut, registerBody, registerFailure, resetPhoneLink, setPhoneLink, setSigningOut, shouldResetDevice, subscribePhoneLink, wipeAtSignIn } from './device-state';

const ME = '7f1c2d3e-0000-4000-8000-000000000001';
const SOMEONE_ELSE = '7f1c2d3e-0000-4000-8000-000000000002';

test('a phone that is not registered registers', () => {
  assert.equal(shouldResetDevice({ registered: false, userId: null }, ME), 'register');
});

test('a phone registered to the signed-in person is left alone', () => {
  assert.equal(shouldResetDevice({ registered: true, userId: ME }, ME), 'none');
});

test('a phone registered to someone else is reset, then registered', () => {
  assert.equal(shouldResetDevice({ registered: true, userId: SOMEONE_ELSE }, ME), 'reset-then-register');
});

test('a phone registered with no user id is reset, then registered', () => {
  assert.equal(shouldResetDevice({ registered: true, userId: null }, ME), 'reset-then-register');
});

test('the register body is the phone model, flavour and app version', () => {
  assert.deepEqual(registerBody({ model: 'Pixel 8', distribution: 'play', appVersion: '1.0.0' }), { name: 'Pixel 8', flavour: 'play', appVersion: '1.0.0' });
});

test('the phone name is cut to 60 characters, never mid-pair, and never blank', () => {
  assert.equal(registerBody({ model: 'x'.repeat(80), distribution: 'direct', appVersion: '1' }).name, 'x'.repeat(60));
  assert.equal(registerBody({ model: `${'x'.repeat(59)}😀`, distribution: 'direct', appVersion: '1' }).name, 'x'.repeat(59));
  assert.equal(registerBody({ model: '   ', distribution: 'direct', appVersion: '1' }).name, 'Android phone');
});

test('a refused registration keeps the server’s own words, short', () => {
  assert.deepEqual(registerFailure(409, { error: 'You have 10 phones signed in.' }), { status: 409, message: 'You have 10 phones signed in.' });
  assert.equal(registerFailure(429, { error: 'y'.repeat(500) }).message.length, 300);
});

test('a refusal with no words of its own gets a plain one', () => {
  assert.deepEqual(registerFailure(500, null), { status: 500, message: 'Your phone couldn’t be added. Try again in a little while.' });
  assert.deepEqual(registerFailure(0, { error: 42 }), { status: 0, message: 'Your phone couldn’t be added. Try again in a little while.' });
});

test('the phone link state tells its listeners and returns the same object until it changes', () => {
  const before = getPhoneLink();
  let calls = 0;
  const stop = subscribePhoneLink(() => { calls += 1; });
  setPhoneLink({ registerError: { status: 409, message: 'Too many phones.' } });
  const after = getPhoneLink();
  assert.notEqual(after, before);
  assert.deepEqual(after.registerError, { status: 409, message: 'Too many phones.' });
  assert.equal(getPhoneLink(), after);
  assert.equal(calls, 1);
  setPhoneLink({ registerError: { status: 409, message: 'Too many phones.' } });
  assert.equal(getPhoneLink(), after, 'an unchanged patch keeps the same object');
  assert.equal(calls, 1, 'and tells no one');
  stop();
  setPhoneLink({ registerError: null, push: 'missing' });
  assert.equal(calls, 1);
  assert.equal(getPhoneLink().push, 'missing');
});

test('a wiped or replaced credential resets what the page knew about the old one', () => {
  setPhoneLink({ registerError: { status: 409, message: 'Too many phones.' }, removed: true, push: 'registered' });
  resetPhoneLink();
  assert.deepEqual(getPhoneLink(), { registerError: null, removed: false, push: 'unknown' });
});

test('signing out is a flag the linking honours until it is cleared', () => {
  assert.equal(isSigningOut(), false);
  setSigningOut(true);
  assert.equal(isSigningOut(), true);
  setSigningOut(false);
  assert.equal(isSigningOut(), false);
});

test('wipeAtSignIn: a phone registered to someone else is wiped', () => {
  assert.equal(wipeAtSignIn({ registered: true, userId: 'old' }, 'new'), true);
});

test('wipeAtSignIn: the same person, an unregistered phone, or no phone at all is left alone', () => {
  assert.equal(wipeAtSignIn({ registered: true, userId: 'me' }, 'me'), false);
  assert.equal(wipeAtSignIn({ registered: false, userId: null }, 'me'), false);
  assert.equal(wipeAtSignIn(null, 'me'), false);
});
