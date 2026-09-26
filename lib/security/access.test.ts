import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessAllowed, accessRestricted, allowedEmails } from './access.ts';

function withList<T>(value: string | undefined, run: () => T): T {
  const before = process.env.ORBIS_ALLOWED_EMAILS;
  if (value === undefined) delete process.env.ORBIS_ALLOWED_EMAILS;
  else process.env.ORBIS_ALLOWED_EMAILS = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.ORBIS_ALLOWED_EMAILS;
    else process.env.ORBIS_ALLOWED_EMAILS = before;
  }
}

test('no list means the app is open, as it was before', () => {
  for (const empty of [undefined, '', '   ', ',', ' , , ']) {
    withList(empty, () => {
      assert.equal(accessRestricted(), false, `treated ${JSON.stringify(empty)} as a list`);
      assert.equal(accessAllowed('anyone@example.com'), true);
      assert.equal(accessAllowed(null), true);
    });
  }
});

test('one address on the list shuts the door on everyone else', () => {
  withList('you@example.com', () => {
    assert.equal(accessRestricted(), true);
    assert.equal(accessAllowed('you@example.com'), true);
    assert.equal(accessAllowed('someone@example.com'), false);
    // A near miss is still a miss.
    assert.equal(accessAllowed('you@example.com.evil.com'), false);
    assert.equal(accessAllowed('xyou@example.com'), false);
  });
});

test('addresses are compared without case or surrounding space', () => {
  withList('  You@Example.COM , second@example.com  ', () => {
    assert.deepEqual(allowedEmails(), ['you@example.com', 'second@example.com']);
    assert.equal(accessAllowed('YOU@EXAMPLE.COM'), true);
    assert.equal(accessAllowed('  second@example.com  '), true);
  });
});

test('a list can be separated by commas, spaces or newlines', () => {
  withList('one@example.com two@example.com\nthree@example.com', () => {
    assert.equal(allowedEmails().length, 3);
    assert.equal(accessAllowed('three@example.com'), true);
  });
});

test('a session with no email is refused while the list is set', () => {
  withList('you@example.com', () => {
    // An anonymous or service session cannot be matched against the list, and
    // something that cannot be attributed is not something to let in.
    assert.equal(accessAllowed(null), false);
    assert.equal(accessAllowed(undefined), false);
    assert.equal(accessAllowed(''), false);
    assert.equal(accessAllowed('   '), false);
  });
});
