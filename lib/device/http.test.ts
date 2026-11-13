import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  deviceCredential,
  MAX_ACTIVE_DEVICES,
  MAX_BODY_BYTES,
  MAX_CONTENT_CHARS,
  MAX_LEDGER_ROWS,
  MAX_SIGNALS,
  newDeviceSecret,
  parseRegister,
  parseSync,
  secretHash,
  SOURCES,
} from './http';

const ID = '7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0001';
const SECRET = 'A'.repeat(43);
// The fixture's dates are all on 2026-11-12; the tests pin "now" next to them.
const NOW = new Date('2026-11-12T12:00:00Z');
const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/device-sync.json',
);
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf8');
const DAY = 24 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;
function fixture(): { meta: Raw; sources: Raw[]; signals: Raw[]; ledger: Raw[] } {
  return JSON.parse(FIXTURE_TEXT);
}
function signal(patch: Raw = {}): Raw {
  return { ...fixture().signals[0], ...patch };
}
function sync(patch: Raw): unknown {
  return parseSync(JSON.stringify({ ...fixture(), ...patch }), NOW);
}
function rejects(result: unknown, hint?: RegExp) {
  assert.equal(typeof result, 'string', `expected a rejection string, got ${JSON.stringify(result)}`);
  if (hint) assert.match(result as string, hint);
}
function accepts(result: unknown) {
  assert.equal(typeof result, 'object', `expected an accepted body, got ${JSON.stringify(result)}`);
}
const uuid = (i: number) => `7b0f6c1e-3a52-4c8e-9d41-${String(i).padStart(12, '0')}`;

describe('constants', () => {
  it('match the plan limits', () => {
    assert.equal(MAX_SIGNALS, 100);
    assert.equal(MAX_CONTENT_CHARS, 4000);
    assert.equal(MAX_BODY_BYTES, 256 * 1024);
    assert.equal(MAX_ACTIVE_DEVICES, 10);
    assert.deepEqual(
      [...SOURCES],
      ['test', 'notifications', 'calendar', 'contacts', 'calls', 'health', 'usage', 'phone_state', 'location'],
    );
  });
});

describe('deviceCredential', () => {
  it('accepts Device <uuid>.<43 base64url chars>', () => {
    assert.deepEqual(deviceCredential(`Device ${ID}.${SECRET}`), { deviceId: ID, secret: SECRET });
    const mixed = 'Ab3-_'.repeat(8) + 'Ab3';
    assert.equal(mixed.length, 43);
    assert.equal(deviceCredential(`Device ${ID}.${mixed}`)?.secret, mixed);
  });

  it('rejects anything else', () => {
    assert.equal(deviceCredential(null), null);
    assert.equal(deviceCredential(''), null);
    assert.equal(deviceCredential(`Bearer ${ID}.${SECRET}`), null);
    assert.equal(deviceCredential(`Device ${ID}${SECRET}`), null);
    assert.equal(deviceCredential(`Device not-a-uuid.${SECRET}`), null);
    assert.equal(deviceCredential(`Device ${ID}.${SECRET.slice(1)}`), null); // 42 chars
    assert.equal(deviceCredential(`Device ${ID}.${SECRET}A`), null); // 44 chars
    assert.equal(deviceCredential(`Device ${ID}.${'A'.repeat(42)}+`), null);
    assert.equal(deviceCredential(` Device ${ID}.${SECRET}`), null);
    assert.equal(deviceCredential(`Device ${ID}.${SECRET}\n`), null);
  });
});

describe('device secrets', () => {
  it('secretHash is sha256 hex, the same as Postgres encode(sha256(convert_to(s, UTF8)), hex)', () => {
    assert.equal(secretHash('s3cret'), '1ec1c26b50d5d3c58d9583181af8076655fe00756bf7285940ba3670f99fcba0');
  });

  it('newDeviceSecret is 43 base64url characters and different each time', () => {
    const a = newDeviceSecret();
    assert.match(a, /^[\w-]{43}$/);
    assert.notEqual(a, newDeviceSecret());
    assert.ok(deviceCredential(`Device ${ID}.${a}`));
  });
});

describe('parseRegister', () => {
  const body = (patch: Raw = {}) =>
    JSON.stringify({ name: 'Pixel 8', flavour: 'direct', appVersion: '0.1.0', ...patch });

  it('accepts a valid body', () => {
    assert.deepEqual(parseRegister(body()), { name: 'Pixel 8', flavour: 'direct', appVersion: '0.1.0' });
    assert.equal((parseRegister(body({ flavour: 'play' })) as { flavour: string }).flavour, 'play');
  });

  it('trims the name and cuts it to 60 characters', () => {
    assert.equal((parseRegister(body({ name: '  Pixel  ' })) as { name: string }).name, 'Pixel');
    const cut = parseRegister(body({ name: 'x'.repeat(100) })) as { name: string };
    assert.equal(cut.name.length, 60);
  });

  it('never leaves half a surrogate pair or trailing space after the cut', () => {
    const emoji = parseRegister(body({ name: 'x'.repeat(59) + '😀' })) as { name: string };
    assert.equal(emoji.name, 'x'.repeat(59));
    const spaced = parseRegister(body({ name: 'x'.repeat(59) + ' y' })) as { name: string };
    assert.equal(spaced.name, 'x'.repeat(59));
  });

  it('rejects bad input with a string', () => {
    rejects(parseRegister(body({ flavour: 'ios' })), /flavour/);
    rejects(parseRegister(body({ flavour: undefined })), /flavour/);
    rejects(parseRegister(body({ name: '   ' })), /name/);
    rejects(parseRegister(body({ name: 5 })), /name/);
    rejects(parseRegister(body({ appVersion: 'v'.repeat(21) })), /appVersion/);
    rejects(parseRegister(body({ appVersion: undefined })), /appVersion/);
    rejects(parseRegister(body({ name: 'a\u0000b' })), /name/);
    rejects(parseRegister('not json'));
    rejects(parseRegister('[]'));
    rejects(parseRegister('null'));
    rejects(parseRegister('x'.repeat(MAX_BODY_BYTES + 1)));
  });
});

describe('parseSync', () => {
  it('accepts the shared fixture and returns it unchanged', () => {
    assert.deepEqual(parseSync(FIXTURE_TEXT, NOW), JSON.parse(FIXTURE_TEXT));
  });

  it('treats missing lists and meta as empty, and drops unknown keys', () => {
    assert.deepEqual(parseSync('{}', NOW), { meta: {}, sources: [], signals: [], ledger: [] });
    const out = parseSync(JSON.stringify({ ...fixture(), extra: 1, meta: { appVersion: '1', x: 2 } }), NOW);
    assert.deepEqual((out as { meta: object }).meta, { appVersion: '1' });
    assert.equal('extra' in (out as object), false);
  });

  it('rejects invalid JSON and non-object bodies', () => {
    rejects(parseSync('{nope', NOW));
    rejects(parseSync('', NOW));
    rejects(parseSync('[]', NOW));
    rejects(parseSync('null', NOW));
    rejects(parseSync('"x"', NOW));
  });

  it('rejects a body over 256 KB', () => {
    rejects(parseSync(JSON.stringify({ meta: { pushToken: 'x'.repeat(MAX_BODY_BYTES) } }), NOW), /large/);
  });

  describe('signals', () => {
    it('accepts 100 signals and rejects 101', () => {
      const make = (n: number) => Array.from({ length: n }, (_, i) => signal({ id: uuid(i) }));
      accepts(sync({ signals: make(100) }));
      rejects(sync({ signals: make(101) }), /signals/);
    });

    it('allows the same id twice in one batch (the database ignores the second)', () => {
      const out = sync({ signals: [signal(), signal()] }) as { signals: unknown[] };
      assert.equal(out.signals.length, 2);
    });

    it('accepts 4,000 characters and rejects 4,001 or none', () => {
      accepts(sync({ signals: [signal({ content: 'x'.repeat(MAX_CONTENT_CHARS) })] }));
      rejects(sync({ signals: [signal({ content: 'x'.repeat(MAX_CONTENT_CHARS + 1) })] }), /content/);
      rejects(sync({ signals: [signal({ content: '' })] }), /content/);
      rejects(sync({ signals: [signal({ content: 12 })] }), /content/);
    });

    it('counts content in UTF-16 units, like Kotlin String.length', () => {
      // 2,001 emoji = 4,002 UTF-16 units
      rejects(sync({ signals: [signal({ content: '😀'.repeat(2001) })] }), /content/);
      accepts(sync({ signals: [signal({ content: '😀'.repeat(2000) })] }));
    });

    it('rejects text the database cannot store', () => {
      rejects(sync({ signals: [signal({ content: 'a\u0000b' })] }), /content/);
      rejects(sync({ signals: [signal({ content: 'a\uD83Db' })] }), /content/); // lone surrogate
      rejects(sync({ signals: [signal({ content: 'a\uD83D' })] }), /content/);
    });

    it('rejects an unknown source', () => {
      rejects(sync({ signals: [signal({ source: 'sms' })] }), /source/);
      rejects(sync({ signals: [signal({ source: 5 })] }), /source/);
      rejects(sync({ sources: [{ source: 'sms', enabled: true }] }), /source/);
      rejects(sync({ ledger: [{ day: '2026-11-12', source: 'sms', kept: 0, dropped: 0, actions: 0 }] }), /source/);
    });

    it('accepts every wire-name source', () => {
      accepts(sync({ signals: SOURCES.map((source, i) => signal({ source, id: uuid(i) })) }));
    });

    it('rejects a non-UUID id', () => {
      rejects(sync({ signals: [signal({ id: 'nope' })] }), /id/);
      rejects(sync({ signals: [signal({ id: '7b0f6c1e3a524c8e9d412f6a8b1c0001' })] }), /id/);
      rejects(sync({ signals: [signal({ id: 7 })] }), /id/);
      rejects(sync({ signals: [signal({ id: undefined })] }), /id/);
    });

    it('returns signal ids lowercase, whatever case the phone sent', () => {
      const upper = '7B0F6C1E-3A52-4C8E-9D41-2F6A8B1C00AB';
      const out = sync({ signals: [signal({ id: upper })] }) as { signals: { id: string }[] };
      assert.equal(out.signals[0].id, upper.toLowerCase());
    });

    it('rejects a kind the database would refuse', () => {
      for (const kind of ['', 'Test', '1test', 'test-item', 'test item', 'a'.repeat(41), 7]) {
        rejects(sync({ signals: [signal({ kind })] }), /kind/);
      }
      accepts(sync({ signals: [signal({ kind: 'a'.repeat(40) })] }));
      accepts(sync({ signals: [signal({ kind: 'a_b' })] }));
    });

    it('rejects a non-object signal and a non-array list', () => {
      rejects(sync({ signals: ['x'] }), /signals/);
      rejects(sync({ signals: [null] }), /signals/);
      rejects(sync({ signals: {} }), /signals/);
    });

    describe('occurredAt window', () => {
      const at = (iso: unknown) => sync({ signals: [signal({ occurredAt: iso })] });
      const shift = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

      it('accepts up to 1 day ahead and 400 days back', () => {
        accepts(at(shift(DAY)));
        accepts(at(shift(-400 * DAY)));
        accepts(at('2026-11-12T08:15:30+05:30'));
        accepts(at('2026-11-12T08:15:30.123456789Z'));
      });

      it('rejects more than 1 day ahead and more than 400 days back', () => {
        rejects(at(shift(DAY + 1000)), /occurredAt/);
        rejects(at(shift(-400 * DAY - 1000)), /occurredAt/);
      });

      it('rejects things that are not ISO timestamps', () => {
        for (const v of [
          'yesterday',
          '',
          '2026-11-12',
          '2026-11-12 08:00:00Z',
          '2026-13-01T00:00:00Z',
          '2026-02-30T00:00:00Z',
          '2026-11-12T25:00:00Z',
          '2026-11-12T08:00:00',
          1794471330123,
          null,
        ]) {
          rejects(at(v), /occurredAt/);
        }
      });
    });
  });

  describe('sources', () => {
    it('needs a boolean enabled', () => {
      rejects(sync({ sources: [{ source: 'test', enabled: 'true' }] }), /enabled/);
      rejects(sync({ sources: [{ source: 'test' }] }), /enabled/);
      accepts(sync({ sources: [{ source: 'test', enabled: false }] }));
    });

    it('holds at most 9 entries', () => {
      const nine = SOURCES.map((source) => ({ source, enabled: false }));
      accepts(sync({ sources: nine }));
      rejects(sync({ sources: [...nine, { source: 'test', enabled: true }] }), /sources/);
    });
  });

  describe('ledger', () => {
    const row = (patch: Raw = {}) => ({ day: '2026-11-12', source: 'test', kept: 1, dropped: 2, actions: 3, ...patch });

    it('accepts a real YYYY-MM-DD and rejects anything else', () => {
      accepts(sync({ ledger: [row({ day: '2024-02-29' })] }));
      for (const day of [
        '2026-1-2',
        '20261112',
        '2026-11-12T00:00:00Z',
        '2026-02-30',
        '2025-02-29',
        '2026-13-01',
        '2026-00-10',
        '0000-01-01',
        'today',
        '',
        20261112,
        null,
      ]) {
        rejects(sync({ ledger: [row({ day })] }), /day/);
      }
    });

    it('rejects negative, fractional, huge or non-numeric counts', () => {
      for (const field of ['kept', 'dropped', 'actions']) {
        const re = new RegExp(field);
        rejects(sync({ ledger: [row({ [field]: -1 })] }), re);
        rejects(sync({ ledger: [row({ [field]: 1.5 })] }), re);
        rejects(sync({ ledger: [row({ [field]: 2147483648 })] }), re);
        rejects(sync({ ledger: [row({ [field]: '3' })] }), re);
        rejects(sync({ ledger: [row({ [field]: null })] }), re);
        rejects(sync({ ledger: [row({ [field]: undefined })] }), re);
        accepts(sync({ ledger: [row({ [field]: 2147483647 })] }));
        accepts(sync({ ledger: [row({ [field]: 0 })] }));
      }
    });

    it(`holds at most ${MAX_LEDGER_ROWS} rows`, () => {
      const make = (n: number) => Array.from({ length: n }, () => row());
      accepts(sync({ ledger: make(MAX_LEDGER_ROWS) }));
      rejects(sync({ ledger: make(MAX_LEDGER_ROWS + 1) }), /ledger/);
    });
  });

  describe('meta', () => {
    it('limits appVersion to 20 and pushToken to 4096; an empty token is allowed', () => {
      accepts(sync({ meta: { appVersion: 'v'.repeat(20) } }));
      rejects(sync({ meta: { appVersion: 'v'.repeat(21) } }), /appVersion/);
      accepts(sync({ meta: { pushToken: 'x'.repeat(4096) } }));
      rejects(sync({ meta: { pushToken: 'x'.repeat(4097) } }), /pushToken/);
      assert.deepEqual((sync({ meta: { pushToken: '' } }) as { meta: object }).meta, { pushToken: '' });
    });

    it('rejects non-string meta values and a non-object meta', () => {
      rejects(sync({ meta: { appVersion: 3 } }), /appVersion/);
      rejects(sync({ meta: { pushToken: null } }), /pushToken/);
      rejects(sync({ meta: { pushToken: 'a\u0000' } }), /pushToken/);
      rejects(sync({ meta: [] }), /meta/);
      rejects(sync({ meta: 'x' }), /meta/);
    });
  });
});
