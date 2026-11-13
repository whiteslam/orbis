import { describe, expect, it } from 'vitest';
import { assetLinks } from '@/lib/native/assetlinks';

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
const FP2 = Array.from({ length: 32 }, () => 'ab').join(':');

describe('assetLinks', () => {
  it('is empty when the app id or fingerprints are unset', () => {
    expect(assetLinks(undefined, FP)).toEqual([]);
    expect(assetLinks('app.orbis', undefined)).toEqual([]);
    expect(assetLinks('', FP)).toEqual([]);
    expect(assetLinks('app.orbis', '')).toEqual([]);
  });

  it('is empty when a fingerprint is not 32 colon-separated hex pairs', () => {
    expect(assetLinks('app.orbis', 'AB:CD')).toEqual([]);
    expect(assetLinks('app.orbis', FP.replace(/:/g, ''))).toEqual([]);
    expect(assetLinks('app.orbis', `${FP},nope`)).toEqual([]);
    expect(assetLinks('app.orbis', `${FP.slice(0, -1)}z`)).toEqual([]);
  });

  it('returns one statement with both relations and upper-cased fingerprints', () => {
    expect(assetLinks(' app.orbis ', ` ${FP2} , ${FP} `)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: { namespace: 'android_app', package_name: 'app.orbis', sha256_cert_fingerprints: [FP2.toUpperCase(), FP.toUpperCase()] },
      },
    ]);
  });
});
