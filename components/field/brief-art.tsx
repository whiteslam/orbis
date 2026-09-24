import type { ArtScene } from '@/lib/focus/types';

// The scene behind a brief slide. It fills the whole card; the copy sits on top of
// it under a scrim (see .fd-slide in globals.css), so every scene keeps its subject
// in the upper half and puts nothing that matters below the waist.
//
// Depth comes from three things rather than from detail: layered shapes at
// different opacities, a soft blur on whatever is meant to be far away, and a glow
// around anything that emits light. Motion is ambient, and stops for reduced-motion.

const CANVAS = { width: 320, height: 280 };

type Scene = { defs?: React.ReactNode; body: React.ReactNode; sky: [string, string] };

/** Rain in three depths: far drizzle, mid rain, and a few near streaks. */
function Rain({ id, night }: { id: string; night: boolean }) {
  const layers = [
    { xs: [18, 52, 88, 124, 160, 196, 232, 268, 302], width: 1.4, length: 13, opacity: night ? 0.34 : 0.3, speed: '2.1s', blur: true },
    { xs: [34, 76, 118, 166, 210, 252, 292], width: 2.2, length: 20, opacity: night ? 0.62 : 0.55, speed: '1.5s', blur: false },
    { xs: [58, 140, 224, 296], width: 3.2, length: 30, opacity: night ? 0.9 : 0.75, speed: '1.05s', blur: false },
  ];
  return (
    <g>
      {layers.map((layer, depth) => (
        <g key={depth} filter={layer.blur ? `url(#${id}-soft)` : undefined}>
          {layer.xs.map((x, index) => (
            <line
              key={x}
              className="art-drop"
              x1={x}
              y1={0}
              x2={x - layer.length * 0.32}
              y2={layer.length}
              stroke={night ? '#bcd6ff' : '#e9f4ff'}
              strokeWidth={layer.width}
              strokeLinecap="round"
              opacity={layer.opacity}
              style={{ animationDuration: layer.speed, animationDelay: `${(index % 4) * 0.37 + depth * 0.2}s` }}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

function Stars({ id }: { id: string }) {
  const stars = [
    [30, 34, 1.7], [74, 18, 1.1], [118, 52, 1.3], [158, 24, 0.9], [196, 44, 1.5],
    [232, 16, 1.1], [268, 40, 1.4], [296, 70, 1], [52, 78, 1.2], [140, 88, 0.9],
  ] as const;
  return (
    <g>
      {stars.map(([x, y, r], index) => (
        <circle
          key={`${x}-${y}`}
          className="art-twinkle"
          cx={x}
          cy={y}
          r={r}
          fill="#f2f6ff"
          style={{ animationDelay: `${(index % 5) * 0.8}s`, animationDuration: `${3 + (index % 3)}s` }}
          filter={index % 3 === 0 ? `url(#${id}-soft)` : undefined}
        />
      ))}
    </g>
  );
}

// The drift animation sets `transform`, which would replace a transform attribute
// on the same element — so position and motion live on separate groups.
function Cloud({ x, y, scale, light, dark, id, far = false, delay = 0 }: { x: number; y: number; scale: number; light: string; dark: string; id: string; far?: boolean; delay?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} filter={far ? `url(#${id}-soft)` : undefined} opacity={far ? 0.55 : 1}>
      <g className="art-drift" style={{ animationDelay: `${delay}s`, animationDuration: far ? '16s' : '11s' }}>
        <ellipse cx="0" cy="10" rx="62" ry="17" fill={dark} />
        <ellipse cx="-30" cy="4" rx="30" ry="20" fill={light} />
        <ellipse cx="8" cy="-6" rx="38" ry="26" fill={light} />
        <ellipse cx="44" cy="4" rx="28" ry="19" fill={light} />
      </g>
    </g>
  );
}

function Hills({ id }: { id: string }) {
  return (
    <g>
      <path d="M0 214c46-30 88-34 132-12s78 30 116 10 52-22 72-14v82H0Z" fill={`url(#${id}-hillFar)`} opacity=".7" />
      <path d="M0 242c54-26 96-22 142 2s84 22 132-6l46-18v62H0Z" fill={`url(#${id}-hillNear)`} />
    </g>
  );
}

function scene(art: ArtScene, night: boolean, id: string): Scene {
  switch (art) {
    case 'rain':
      return night
        ? {
            sky: ['#0d1533', '#26305e'],
            defs: (
              <radialGradient id={`${id}-moon`} cx="50%" cy="50%">
                <stop offset="0" stopColor="#fdfbe8" stopOpacity=".85" />
                <stop offset="1" stopColor="#fdfbe8" stopOpacity="0" />
              </radialGradient>
            ),
            body: (
              <>
                <Stars id={id} />
                <circle cx="246" cy="52" r="46" fill={`url(#${id}-moon)`} />
                <path className="art-float" d="M258 38a18 18 0 1 1-16-18 14 14 0 0 0 16 18Z" fill="#fdfbe8" />
                <Cloud id={id} x={96} y={78} scale={0.9} light="#3a4477" dark="#2b3363" far delay={1.4} />
                <Cloud id={id} x={214} y={100} scale={1.15} light="#485287" dark="#343d72" />
                <Rain id={id} night />
              </>
            ),
          }
        : {
            sky: ['#3f7cb8', '#9dc7e6'],
            body: (
              <>
                <Cloud id={id} x={72} y={64} scale={0.85} light="#f6fbff" dark="#cfe0ef" far delay={1.8} />
                <Cloud id={id} x={206} y={92} scale={1.2} light="#ffffff" dark="#c4d8ea" />
                <Rain id={id} night={false} />
              </>
            ),
          };

    case 'sun':
      return {
        sky: ['#d9671f', '#f8d089'],
        defs: (
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%">
            <stop offset="0" stopColor="#fff6dd" stopOpacity=".95" />
            <stop offset=".45" stopColor="#ffd98f" stopOpacity=".45" />
            <stop offset="1" stopColor="#ffca70" stopOpacity="0" />
          </radialGradient>
        ),
        body: (
          <>
            <circle cx="196" cy="80" r="118" fill={`url(#${id}-glow)`} />
            <g className="art-spin" style={{ transformOrigin: '196px 80px' }}>
              {Array.from({ length: 16 }, (_, index) => (
                <rect key={index} x="193" y="0" width="6" height="22" rx="3" fill="#fff6dd" opacity={index % 2 ? 0.4 : 0.75} transform={`rotate(${index * 22.5} 196 80)`} />
              ))}
            </g>
            <circle className="art-pulse" cx="196" cy="80" r="38" fill="#fff9ea" style={{ transformOrigin: '196px 80px' }} />
            <g opacity=".45">
              <path className="art-drift" d="M12 148h118M150 148h64" stroke="#fff3d0" strokeWidth="4" strokeLinecap="round" />
              <path className="art-drift" d="M40 172h94M158 172h130" stroke="#fff3d0" strokeWidth="4" strokeLinecap="round" style={{ animationDelay: '1.6s' }} />
            </g>
          </>
        ),
      };

    case 'cold':
      return {
        sky: ['#3c5f96', '#b6d2e8'],
        body: (
          <>
            <g filter={`url(#${id}-soft)`} opacity=".5">
              {[40, 150, 260].map((x, index) => (
                <g key={x} className="art-fall" style={{ animationDelay: `${index * 1.6}s`, animationDuration: '9s' }}>
                  <path d={`M${x} 0v26M${x - 11} 6l22 14M${x + 11} 6l-22 14`} stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                </g>
              ))}
            </g>
            {[76, 128, 196, 246, 296].map((x, index) => (
              <g key={x} className="art-fall" style={{ animationDelay: `${index * 1.1}s`, animationDuration: `${6 + (index % 3)}s` }}>
                <path d={`M${x} 0v18M${x - 8} 4l16 10M${x + 8} 4l-16 10`} stroke="#f4faff" strokeWidth="2.4" strokeLinecap="round" opacity=".9" />
              </g>
            ))}
          </>
        ),
      };

    case 'alerts':
      return {
        sky: ['#a8412f', '#e39374'],
        defs: (
          <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdfa" />
            <stop offset="1" stopColor="#f5ded2" />
          </linearGradient>
        ),
        body: (
          <>
            <g opacity=".4" transform="translate(0 22) rotate(-5 160 90)">
              <rect x="86" y="40" width="148" height="86" rx="12" fill="#fff0e6" />
            </g>
            <g opacity=".7" transform="translate(0 11) rotate(3 160 90)">
              <rect x="82" y="40" width="156" height="90" rx="12" fill="#fff6ef" />
            </g>
            <g className="art-float">
              <rect x="74" y="34" width="172" height="94" rx="13" fill={`url(#${id}-paper)`} />
              <path d="M74 46l86 52 86-52" fill="none" stroke="#b34a35" strokeWidth="5" strokeLinejoin="round" opacity=".65" />
              <path d="M74 128l64-44M246 128l-64-44" stroke="#e0c3b4" strokeWidth="3" />
              <circle cx="238" cy="38" r="22" fill="#ffffff" opacity=".35" filter={`url(#${id}-soft)`} />
              <circle className="art-pulse" cx="238" cy="38" r="13" fill="#ffffff" style={{ transformOrigin: '238px 38px' }} />
              <circle cx="238" cy="38" r="7" fill="#c2402a" />
            </g>
          </>
        ),
      };

    case 'money':
      return {
        sky: ['#1d6b4c', '#84c9a2'],
        defs: (
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d8f1e3" />
          </linearGradient>
        ),
        body: (
          <>
            <ellipse cx="170" cy="176" rx="130" ry="16" fill="#0c3d2b" opacity=".18" filter={`url(#${id}-soft)`} />
            {[[84, 46], [124, 74], [164, 36], [204, 96], [244, 66]].map(([x, height], index) => (
              <rect
                key={x}
                className="art-rise"
                x={x}
                y={172 - height}
                width="28"
                height={height}
                rx="8"
                fill={`url(#${id}-bar)`}
                opacity={index === 3 ? 1 : 0.78}
                style={{ transformOrigin: `${x}px 172px`, animationDelay: `${index * 0.14}s` }}
              />
            ))}
            <g className="art-float">
              <circle cx="58" cy="62" r="27" fill="#fdf3d2" />
              <circle cx="58" cy="62" r="27" fill="none" stroke="#e8c98a" strokeWidth="3" />
              <text x="58" y="73" textAnchor="middle" fontSize="30" fontWeight="700" fill="#1d6b4c">₹</text>
            </g>
          </>
        ),
      };

    case 'steps-up':
    case 'steps-down': {
      const up = art === 'steps-up';
      const line = up ? 'M18 186 74 160 130 168 186 110 254 64 310 42' : 'M18 52 74 82 130 72 186 130 254 166 310 190';
      return {
        sky: up ? ['#15706a', '#6fcbba'] : ['#7d4f34', '#d3a37e'],
        defs: (
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".38" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        ),
        body: (
          <>
            <g opacity=".2">
              {[60, 106, 152, 198].map((y) => <path key={y} d={`M0 ${y}h320`} stroke="#ffffff" strokeWidth="1.5" />)}
            </g>
            <path d={`${line} L310 280 L18 280 Z`} fill={`url(#${id}-fill)`} />
            <path className="art-draw" d={line} fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="310" cy={up ? 42 : 190} r="18" fill="#ffffff" opacity=".3" filter={`url(#${id}-soft)`} />
            <circle className="art-pulse" cx="310" cy={up ? 42 : 190} r="8.5" fill="#ffffff" style={{ transformOrigin: `310px ${up ? 42 : 190}px` }} />
            {(up ? [[74, 160], [130, 168], [186, 110]] : [[74, 82], [130, 72], [186, 130]]).map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="4.5" fill="#ffffff" opacity=".6" />
            ))}
          </>
        ),
      };
    }

    case 'goal':
      return {
        sky: ['#3b3596', '#9d93e4'],
        defs: (
          <radialGradient id={`${id}-halo`} cx="50%" cy="50%">
            <stop offset=".55" stopColor="#ffffff" stopOpacity=".3" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        ),
        body: (
          <>
            <circle cx="160" cy="92" r="96" fill={`url(#${id}-halo)`} />
            <circle cx="160" cy="92" r="58" fill="none" stroke="#ffffff" strokeWidth="12" opacity=".25" />
            <circle
              className="art-sweep"
              cx="160"
              cy="92"
              r="58"
              fill="none"
              stroke="#ffffff"
              strokeWidth="12"
              strokeLinecap="round"
              transform="rotate(-90 160 92)"
            />
            <circle className="art-pulse" cx="160" cy="92" r="15" fill="#ffffff" style={{ transformOrigin: '160px 92px' }} />
            {[[62, 44], [254, 58], [88, 150], [240, 146]].map(([x, y], index) => (
              <circle key={x} className="art-twinkle" cx={x} cy={y} r="3.5" fill="#ffffff" style={{ animationDelay: `${index * 0.9}s` }} />
            ))}
          </>
        ),
      };

    case 'link':
      return {
        sky: ['#1b4f8f', '#7fb6e8'],
        defs: (
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#cfe2f6" />
          </linearGradient>
        ),
        body: (
          <>
            <circle cx="160" cy="92" r="66" fill="#ffffff" opacity=".18" filter={`url(#${id}-soft)`} />
            <g className="art-join-left">
              <rect x="42" y="70" width="108" height="46" rx="23" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="11" />
            </g>
            <g className="art-join-right">
              <rect x="170" y="70" width="108" height="46" rx="23" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="11" />
            </g>
            <rect className="art-pulse" x="140" y="86" width="40" height="14" rx="7" fill="#ffffff" style={{ transformOrigin: '160px 93px' }} />
          </>
        ),
      };

    case 'document':
      return {
        sky: ['#7a5c26', '#dfc086'],
        defs: (
          <linearGradient id={`${id}-page`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fffdf6" />
            <stop offset="1" stopColor="#f1e2c6" />
          </linearGradient>
        ),
        body: (
          <>
            <rect x="96" y="34" width="130" height="140" rx="12" fill="#5c431a" opacity=".25" filter={`url(#${id}-soft)`} transform="translate(8 10)" />
            <g className="art-float">
              <rect x="92" y="26" width="136" height="144" rx="13" fill={`url(#${id}-page)`} />
              <path d="M112 58h96M112 80h96M112 102h96M112 124h60" stroke="#8a6b33" strokeWidth="6" strokeLinecap="round" opacity=".4" />
              <path d="M112 146h56" stroke="#b8933f" strokeWidth="6" strokeLinecap="round" opacity=".6" />
            </g>
            <rect className="art-scan" x="92" y="26" width="46" height="144" fill="#ffffff" opacity=".3" />
          </>
        ),
      };

    case 'saved':
      return {
        sky: ['#26365c', '#8fa9cd'],
        body: (
          <>
            <Stars id={id} />
            <circle cx="160" cy="96" r="72" fill="#ffffff" opacity=".14" filter={`url(#${id}-soft)`} />
            <g className="art-float">
              <path d="M118 30h84a10 10 0 0 1 10 10v108l-52-30-52 30V40a10 10 0 0 1 10-10Z" fill="#ffffff" opacity=".95" />
              <path d="M140 88l16 16 30-32" fill="none" stroke="#2a3c63" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </>
        ),
      };

    case 'broken':
      return {
        sky: ['#6d2b26', '#c98376'],
        body: (
          <>
            <circle cx="160" cy="92" r="64" fill="#ffd9a8" opacity=".22" filter={`url(#${id}-soft)`} />
            <g>
              <rect x="34" y="72" width="88" height="42" rx="14" fill="#ffeee9" />
              <path d="M122 82h26M122 104h26" stroke="#ffeee9" strokeWidth="9" strokeLinecap="round" />
            </g>
            <g className="art-shake" style={{ transformOrigin: '230px 93px' }}>
              <rect x="198" y="72" width="88" height="42" rx="14" fill="#ffeee9" />
              <path d="M172 82h26M172 104h26" stroke="#ffeee9" strokeWidth="9" strokeLinecap="round" />
            </g>
            <path className="art-twinkle" d="M160 44l-14 30h19l-12 30" fill="none" stroke="#ffd469" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ),
      };

    case 'calm':
    default:
      return {
        sky: night ? ['#151c3d', '#3c3f72'] : ['#2f5a75', '#9dc3d1'],
        defs: (
          <>
            <radialGradient id={`${id}-moon`} cx="50%" cy="50%">
              <stop offset="0" stopColor="#fdf7dd" stopOpacity=".8" />
              <stop offset="1" stopColor="#fdf7dd" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-hillFar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={night ? '#2b3163' : '#5c8497'} />
              <stop offset="1" stopColor={night ? '#1d2247' : '#47697a'} />
            </linearGradient>
            <linearGradient id={`${id}-hillNear`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={night ? '#1a1f42' : '#3f5f6f'} />
              <stop offset="1" stopColor={night ? '#121634' : '#314b58'} />
            </linearGradient>
          </>
        ),
        body: (
          <>
            {night && <Stars id={id} />}
            <circle cx="238" cy="60" r="54" fill={`url(#${id}-moon)`} />
            <circle className="art-float" cx="238" cy="60" r="24" fill="#fdf7dd" opacity=".95" />
            <Hills id={id} />
          </>
        ),
      };
  }
}

export function BriefArt({ art, night = false }: { art: ArtScene; night?: boolean }) {
  const id = `art-${art}-${night ? 'n' : 'd'}`;
  const { sky, defs, body } = scene(art, night, id);
  return (
    <svg
      className="brief-art"
      viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="1" stopColor={sky[1]} />
        </linearGradient>
        <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        {defs}
      </defs>
      <rect width={CANVAS.width} height={CANVAS.height} fill={`url(#${id}-sky)`} />
      {body}
    </svg>
  );
}
