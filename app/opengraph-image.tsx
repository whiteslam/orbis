import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/site';

export const alt = `${SITE_NAME} — one calm daily brief for your money, health and routines`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The brand values, copied from app/styles/brand.css: ImageResponse renders
// outside the page, so CSS variables do not reach it.
const tokens = {
  ground: '#0e0e10',
  ink: '#f2f3f5',
  ring: 'linear-gradient(135deg, #5bb4e8, #42cca8)',
  font: 'sans-serif',
} as const;

// A generated share preview using the Orbis brand ring and colours, so links to
// Orbis look intentional wherever they're shared — no static asset to keep in sync.
export default function Image() {
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
          background: tokens.ground,
          color: tokens.ink,
          fontFamily: tokens.font,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: tokens.ring,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 25, height: 25, borderRadius: 13, background: tokens.ground }} />
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
