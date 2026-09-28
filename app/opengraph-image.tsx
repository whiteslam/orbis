import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/site';

export const alt = `${SITE_NAME} — one calm daily brief for your money, health and routines`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// A generated share preview using the Field brand colours, so links to
// Orbis look intentional wherever they're shared — no static asset to keep in sync.
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(176deg, #101614 0%, #131b19 46%, #0a100e 100%)',
          color: '#eaf0ed',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: '#85b3a3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 700,
              color: '#101715',
            }}
          >
            O
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em' }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 56, fontSize: 54, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, maxWidth: 980 }}>
          One calm daily brief for your money, health and routines.
        </div>
      </div>
    ),
    { ...size },
  );
}
