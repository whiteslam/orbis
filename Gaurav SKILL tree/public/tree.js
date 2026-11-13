// The skill tree itself: growth over time, stones, camera, side panel and particles.
(function () {
  const { nodes: rawNodes, branches, stats, timeline } = window.TREE;
  const NS = 'http://www.w3.org/2000/svg';
  const WORLD = { w: 2000, h: 1125 };
  const FORK = { x: 1000, y: 820 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const WALLPAPER = params.has('wallpaper');
  const STILL = params.has('still');
  if (WALLPAPER) document.body.classList.add('wallpaper');
  if (STILL) document.body.classList.add('still');
  const DAY = 86400000;
  const svg = document.getElementById('tree');
  const color = Object.fromEntries(branches.map((b) => [b.id, b.color]));
  const ms = (d) => Date.parse(`${d}T00:00:00Z`);
  const START = ms(stats.from) - DAY * 2;
  const END = ms(stats.to) + DAY;
  const timeMs = timeline.map(ms);

  const ICONS = {
    layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
    cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    db: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    spark: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
    shield: 'M12 3l8 3v6c0 4.6-3.3 7.7-8 9-4.7-1.3-8-4.4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
    flag: 'M5 21V4M5 4c4-2 7 2 14 0v9c-7 2-10-2-14 0',
    pen: 'M4 20l1-5L16 4l4 4L9 19zM13.5 6.5l4 4',
    blocks: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    phone: 'M8 3h8a1.5 1.5 0 011.5 1.5v15A1.5 1.5 0 0116 21H8a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 018 3zM11 18h2',
    hand: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
    globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    list: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 1.5-2M4 12l1 1 1.5-2M4 18l1 1 1.5-2',
    route: 'M6 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8.5 17.5H15a3 3 0 000-6H9a3 3 0 010-6h6.5',
    sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    check: 'M4 4h16v16H4zM8 12l3 3 5-6',
    bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4',
    calendar: 'M4 6h16v15H4zM4 11h16M8 3v5M16 3v5',
    book: 'M5 4h6a2 2 0 012 2v14a2 2 0 00-2-2H5zM19 4h-6M13 6a2 2 0 012-2h4v14h-4a2 2 0 00-2 2',
    card: 'M3 6h18v13H3zM3 10.5h18M7 15.5h4',
    scale: 'M12 4v16M7 20h10M5 7h14M5 7l-2.5 6h5zM19 7l-2.5 6h5z',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4',
    key: 'M15 3a6 6 0 11-5.2 9L3 18.8V21h3v-2h2v-2h2l1.5-1.5A6 6 0 0115 3zM16.5 7.5h.01',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3.5 2',
    robot: 'M5 9h14v10H5zM12 9V5M12 4h.01M9 13h.01M15 13h.01M9.5 16.5h5M2.5 12.5v3M21.5 12.5v3',
    quote: 'M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5',
    chip: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    flask: 'M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3M7.5 15h9',
    mountain: 'M2 20L9 7l4 7 2.5-3.5L22 20zM7 11l2 1.5L11 11',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4M12 15v2',
    bug: 'M8 8h8a2 2 0 012 2v5a6 6 0 01-12 0v-5a2 2 0 012-2zM9 8a3 3 0 016 0M12 11v9M3 13h3M18 13h3M4 8l2.5 2M20 8l-2.5 2M4 20l2.5-2.5M20 20l-2.5-2.5',
    bolt: 'M13 2L5 14h6l-1 8 9-13h-6z',
    branch: 'M6 3v12M6 15a3 3 0 100 6 3 3 0 000-6zM18 3a3 3 0 100 6 3 3 0 000-6zM18 9c0 4-6 3-12 6',
    map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
    terminal: 'M3 4h18v16H3zM7 9l3.5 3L7 15M13 15h4',
    chat: 'M4 5h16v11h-8l-4 4v-4H4zM8 9h8M8 12.5h5',
    box: 'M4 8l8-4.5L20 8v9l-8 4.5L4 17zM4 8l8 4.5L20 8M12 12.5v9',
    seed: 'M12 21c-4 0-6-3-6-6 0-5 6-12 6-12s6 7 6 12c0 3-2 6-6 6zM12 21v-8M12 15l-3-3M12 13l2.5-2.5',
  };

  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // Scene graph
  const nodes = rawNodes.map((n) => ({ ...n, date: n.first ? ms(n.first) : null, hub: n.kind === 'hub' }));
  const rootNode = { id: 'root', kind: 'root', x: FORK.x, y: 1005, name: 'Gaurav', label: 'Gaurav', icon: 'seed', branch: null, date: START, first: stats.from };
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  byId.root = rootNode;
  const childrenOf = (id) => nodes.filter((n) => n.parent === id);
  // In the replay a stone waits for the stone it grows from, even if its own first proof is older.
  // The dates shown in the panel stay the real ones.
  const settled = new Set();
  const settle = (n) => {
    if (settled.has(n.id)) return;
    settled.add(n.id);
    const parent = byId[n.parent];
    if (!parent || n.date === null) return;
    if (parent.kind !== 'root') settle(parent);
    if (parent.date > n.date) n.date = parent.date;
  };
  nodes.forEach(settle);

  const defs = el('defs', {}, svg);
  const radial = (id, stops) => {
    const g = el('radialGradient', { id }, defs);
    stops.forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, g));
  };
  branches.forEach((b) => radial(`halo-${b.id}`, [[0, b.color, .75], [.45, b.color, .22], [1, b.color, 0]]));
  radial('halo-root', [[0, '#FFD27A', .85], [.45, '#FFD27A', .25], [1, '#FFD27A', 0]]);
  radial('stone', [[0, '#2F3180', 1], [1, '#14173F', 1]]);
  radial('workerGlow', [[0, '#7FE8D6', .34], [.6, '#7FE8D6', .1], [1, '#7FE8D6', 0]]);
  const barkG = el('linearGradient', { id: 'barkGradient', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  [[0, '#1E1636'], [.45, '#5A3F62'], [1, '#231A3C']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, barkG));
  const groundG = el('linearGradient', { id: 'groundGradient', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  [[0, '#191B4C'], [.35, '#0E1034']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, groundG));

  const cam = el('g', { id: 'camera' }, svg);

  // Curves
  const bez = (e, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * e.p0.x + 3 * u * u * t * e.c1.x + 3 * u * t * t * e.c2.x + t * t * t * e.p3.x,
      y: u * u * u * e.p0.y + 3 * u * u * t * e.c1.y + 3 * u * t * t * e.c2.y + t * t * t * e.p3.y,
    };
  };
  const tan = (e, t) => {
    const u = 1 - t;
    const x = 3 * u * u * (e.c1.x - e.p0.x) + 6 * u * t * (e.c2.x - e.c1.x) + 3 * t * t * (e.p3.x - e.c2.x);
    const y = 3 * u * u * (e.c1.y - e.p0.y) + 6 * u * t * (e.c2.y - e.c1.y) + 3 * t * t * (e.p3.y - e.c2.y);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  };
  // Draws a limb that tapers along its length, up to fraction t of the way.
  const limb = (e, t, widthScale = 1, shift = 0) => {
    const n = 18, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * t;
      const p = bez(e, f), d = tan(e, f);
      const full = (e.w0 + (e.w1 - e.w0) * f) / 2;
      const hw = full * widthScale, off = full * shift;
      const cx = p.x + d.y * off, cy = p.y - d.x * off;
      left.push(`${(cx - d.y * hw).toFixed(1)} ${(cy + d.x * hw).toFixed(1)}`);
      right.unshift(`${(cx + d.y * hw).toFixed(1)} ${(cy - d.x * hw).toFixed(1)}`);
    }
    return `M${left.join('L')}L${right.join('L')}Z`;
  };

  const depthOf = (n) => (n.parent === 'root' ? 0 : n.parent && byId[n.parent] && byId[n.parent].hub ? 1 : 2);

  function makeEdge(n, parentGroup, sapGroup) {
    const parent = n.parent === 'root' ? FORK : byId[n.parent];
    const spreadAt = n.parent === 'root' ? (branches.findIndex((b) => b.id === n.id) - 2.5) * 7 : 0;
    const p0 = { x: parent.x + spreadAt, y: parent.y }, p3 = { x: n.x, y: n.y };
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    let dir;
    if (n.parent === 'root') dir = { x: 0, y: -1 };
    else {
      const gp = byId[n.parent].parent === 'root' ? FORK : byId[byId[n.parent].parent];
      const l = Math.hypot(p0.x - gp.x, p0.y - gp.y) || 1;
      dir = { x: (p0.x - gp.x) / l, y: (p0.y - gp.y) / l };
    }
    const toward = { x: (p3.x - p0.x) / dist, y: (p3.y - p0.y) / dist };
    const bend = (n.x < WORLD.w / 2 ? -1 : 1) * dist * .07;
    const edge = {
      n, p0, p3,
      c1: { x: p0.x + (dir.x * .55 + toward.x * .45) * dist * .42, y: p0.y + (dir.y * .55 + toward.y * .45) * dist * .42 },
      c2: { x: p3.x - toward.x * dist * .3 - toward.y * bend, y: p3.y - toward.y * dist * .3 + toward.x * bend },
      t: -1,
    };
    const d = depthOf(n);
    edge.w0 = d === 0 ? 27 : d === 1 ? 13 : 9;
    edge.w1 = d === 0 ? 13 : d === 1 ? 6 : 4.5;
    const centre = `M${p0.x} ${p0.y}C${edge.c1.x} ${edge.c1.y} ${edge.c2.x} ${edge.c2.y} ${p3.x} ${p3.y}`;
    if (n.locked) {
      edge.locked = el('path', { d: centre, class: 'edge-locked', opacity: 0 }, parentGroup);
      return edge;
    }
    edge.bark = el('path', { class: 'bark', d: '' }, parentGroup);
    edge.light = el('path', { class: 'bark-light', d: '' }, parentGroup);
    edge.grow = el('path', { d: centre, class: 'sap-grow', stroke: color[n.branch], opacity: 0 }, sapGroup);
    edge.flow = el('path', { d: centre, class: `sap-flow ${d > 0 ? 'twig' : ''}`, stroke: color[n.branch], opacity: 0 }, sapGroup);
    edge.len = edge.grow.getTotalLength();
    edge.grow.style.strokeDasharray = edge.len;
    edge.flow.style.animationDelay = `${-Math.random() * 3}s`;
    return edge;
  }

  function makeStone(n, group) {
    const r = n.kind === 'root' ? 52 : n.hub ? 47 : 27 + (n.level || 0) * 1.6;
    n.r = r;
    const accent = n.branch ? color[n.branch] : '#FFD27A';
    const g = el('g', {
      class: `node ${n.hub ? 'hub' : ''} ${n.kind === 'root' ? 'root-node' : ''} ${n.locked ? 'locked' : ''}`,
      transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: 'button',
      'aria-label': n.locked ? `${n.name}. Not unlocked yet.` : n.hub ? `${n.name} branch` : n.kind === 'root' ? 'Gaurav. Overview of all commits.' : `${n.name}. Level ${n.level} of 5.`,
    }, group);
    const inner = el('g', { class: 'node-inner' }, g);
    if (!n.locked) {
      const halo = el('circle', { r: r * 2.3, class: 'halo', fill: `url(#halo-${n.branch || 'root'})` }, inner);
      halo.style.animationDelay = `${-Math.random() * 3.6}s`;
      const leaves = n.kind === 'root' ? 0 : n.hub ? 7 : 4;
      for (let i = 0; i < leaves; i++) {
        const angle = (i / leaves) * 360 + (n.x % 40);
        const holder = el('g', { transform: `rotate(${angle}) translate(0 ${-r - 3})` }, inner);
        const len = 13 + (i % 3) * 4;
        const leaf = el('path', { class: 'leaf', d: `M0 0C${len * .5} ${-len * .3} ${len * .45} ${-len * .85} 0 ${-len}C${-len * .45} ${-len * .85} ${-len * .5} ${-len * .3} 0 0Z`, fill: accent, opacity: .72 }, holder);
        leaf.style.animationDelay = `${-Math.random() * 4}s`;
      }
    }
    el('circle', { r: r + 11, class: 'select-ring' }, inner);
    el('circle', { r: r + 9, class: 'focus-ring' }, inner);
    const face = el('g', { class: 'face-group' }, inner);
    el('circle', { r, fill: 'url(#stone)', stroke: n.locked ? '#8A8DB8' : accent, 'stroke-width': n.hub || n.kind === 'root' ? 4 : 2.8, 'stroke-dasharray': n.locked ? '5 5' : 'none' }, face);
    const size = r * (n.hub || n.kind === 'root' ? 1.1 : 1.14);
    const scale = size / 24;
    el('path', { d: ICONS[n.icon] || ICONS.spark, transform: `translate(${-size / 2} ${-size / 2}) scale(${scale})`, fill: 'none', stroke: n.locked ? '#A9ABCF' : accent, 'stroke-width': 1.7 / Math.max(scale, .9), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, face);

    // Level pips sit on the rim of the stone.
    if (n.kind === 'skill' && !n.locked) {
      const arcR = r + 6, gap = 5, span = (120 - gap * 4) / 5;
      for (let i = 0; i < 5; i++) {
        const a0 = (-60 + i * (span + gap)) * Math.PI / 180;
        const a1 = a0 + span * Math.PI / 180;
        const on = i < n.level;
        el('path', {
          d: `M${(Math.sin(a0) * arcR).toFixed(1)} ${(-Math.cos(a0) * arcR).toFixed(1)}A${arcR} ${arcR} 0 0 1 ${(Math.sin(a1) * arcR).toFixed(1)} ${(-Math.cos(a1) * arcR).toFixed(1)}`,
          fill: 'none', stroke: on ? accent : 'rgba(255,243,228,.2)', 'stroke-width': 4, 'stroke-linecap': 'round',
        }, face);
      }
    }

    const text = el('text', { class: 'label', x: n.kind === 'root' ? r + 14 : 0, y: n.kind === 'root' ? 11 : r + (n.hub ? 36 : 28) }, inner);
    n.label.split('\n').forEach((line, i) => {
      const t = el('tspan', { x: n.kind === 'root' ? r + 14 : 0, dy: i === 0 ? 0 : (n.hub ? 28 : 21) }, text);
      t.textContent = line;
    });

    n.el = g; n.inner = inner;
    g.addEventListener('click', (e) => { if (!dragMoved) { e.stopPropagation(); select(n); } });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n); } });
  }

  // Ground, with the tree rooted into it.
  let hill = 'M-3000 1088';
  [[-1400, 1040], [-500, 1090], [200, 1062], [620, 1084], [1000, 1060], [1400, 1090], [1800, 1056], [2500, 1084], [5000, 1040]]
    .forEach(([x, y], i, all) => {
      const prev = i ? all[i - 1] : [-3000, 1088];
      hill += `C${(prev[0] + x) / 2} ${prev[1]} ${(prev[0] + x) / 2} ${y} ${x} ${y}`;
    });
  hill += 'V4000H-3000Z';
  el('path', { d: hill, fill: 'url(#groundGradient)' }, cam);

  const trunkEdge = { p0: { x: 1000, y: 1110 }, c1: { x: 1006, y: 1020 }, c2: { x: 990, y: 920 }, p3: FORK, w0: 84, w1: 52 };
  const treeRoots = [[-150, 1110, -66, 1088], [150, 1112, 70, 1086], [-84, 1124, -30, 1096], [90, 1124, 34, 1098]];
  treeRoots.forEach(([dx, y, cx, cy]) => {
    el('path', { class: 'bark', d: limb({ p0: { x: 1000 + cx * .4, y: 1072 }, c1: { x: 1000 + cx * .7, y: cy }, c2: { x: 1000 + cx, y: cy + 8 }, p3: { x: 1000 + dx, y }, w0: 24, w1: 3 }, 1) }, cam);
  });
  const trunk = el('path', { class: 'bark trunk', d: limb(trunkEdge, 1) }, cam);
  el('path', { class: 'bark-light', d: limb(trunkEdge, 1, .2, -.42) }, cam);
  const trunkSap = el('path', { class: 'sap-flow', d: 'M1000 1110C1006 1020 990 920 1000 820', stroke: '#FFD27A', opacity: 1 }, cam);
  trunk.setAttribute('aria-hidden', 'true'); trunkSap.setAttribute('aria-hidden', 'true');

  // Each of the six limbs sways as one piece, stones included.
  const edges = [];
  const stoneLayers = [];
  // Limbs and stones sit on separate layers, so no limb ever crosses a stone or its name.
  const limbsRoot = el('g', {}, cam);
  const stonesRoot = el('g', {}, cam);
  branches.forEach((b, i) => {
    const swaying = (parent) => {
      const g = el('g', { class: 'bough' }, parent);
      g.style.animationDelay = `${-i * 1.7}s`;
      g.style.animationDuration = `${7.4 + i * .55}s`;
      return g;
    };
    const bough = swaying(limbsRoot);
    const barkLayer = el('g', {}, bough);
    const sapLayer = el('g', {}, bough);
    const stones = swaying(stonesRoot);
    stoneLayers.push(stones);
    const walk = (id) => childrenOf(id).filter((c) => c.branch === b.id).forEach((c) => { edges.push(makeEdge(c, barkLayer, sapLayer)); walk(c.id); });
    edges.push(makeEdge(byId[b.id], barkLayer, sapLayer));
    walk(b.id);
    nodes.filter((n) => n.branch === b.id).forEach((n) => makeStone(n, stones));
  });
  makeStone(rootNode, cam);
  rootNode.el.classList.add('lit');

  // The character working under the tree. Decoration only, so clicks and drags pass straight through.
  (function drawWorker() {
    const OUTLINE = '#12133A';
    const bar = (d, width, colour, extra = '') => `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="${width + 3.4}" stroke-linecap="round" stroke-linejoin="round" ${extra}/><path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
    const codeLines = [
      [2, 28, '#7FE8D6'], [6, 20, '#FFCB6B'], [6, 26, '#C9C6EC'], [2, 16, '#FFA6B2'], [6, 24, '#7FE8D6'], [10, 14, '#DDB0FF'], [6, 22, '#FFCB6B'], [2, 18, '#C9C6EC'],
    ];
    const lineSet = (offset) => codeLines.map(([x, w, c], i) => `<rect x="${x}" y="${offset + i * 5.5}" width="${w}" height="2.4" rx="1.2" fill="${c}"/>`).join('');
    const g = el('g', { class: 'worker', transform: 'translate(868 1064) scale(1.36)', 'aria-hidden': 'true' }, cam);
    g.innerHTML = `
      <ellipse cx="-22" cy="1" rx="80" ry="8" fill="#080A2A" opacity=".55"/>
      <ellipse cx="-30" cy="-58" rx="62" ry="50" fill="url(#workerGlow)" class="worker-glow"/>

      <!-- Leg on the far side -->
      ${bar('M-2 -12 L-36 -54 L-58 -9', 16, '#3B4796')}
      <path d="M-66 -11 q-3 -7 8 -8 l8 6 l-2 8 l-16 0 q-3 -2 2 -6z" fill="#BDB6D6" stroke="${OUTLINE}" stroke-width="1.7"/>

      <!-- Body and head breathe together -->
      <g class="worker-breathe">
        <path d="M-17 -5 C-24 -36 -16 -66 6 -76 C22 -80 31 -68 30 -48 C29 -30 27 -14 24 -3 Z" fill="#F08A6C" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M-9 -61 C-2 -73 13 -80 25 -72 C33 -62 30 -49 22 -47 C10 -47 -1 -51 -9 -61Z" fill="#D96F55" stroke="${OUTLINE}" stroke-width="1.6"/>
        <path d="M2 -35 C8 -30 17 -30 23 -35 L21 -22 C15 -19 8 -19 4 -22Z" fill="#D96F55"/>

        <g class="worker-head">
          <path d="M-2 -76 L12 -73 L10 -61 L-2 -66Z" fill="#B97A50"/>
          <path d="M-14 -94 C-14 -105 -5 -111 5 -110 C16 -109 22 -101 21 -90 C20 -79 12 -72 2 -72 C-6 -72 -12 -77 -13 -84 L-17 -87 Q-18 -89 -15 -91Z" fill="#CC9064" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M-14 -96 C-16 -108 -4 -117 8 -114 C21 -112 28 -100 23 -84 C21 -79 16 -77 14 -78 C15 -84 13 -89 9 -92 C5 -96 -6 -95 -14 -96Z" fill="#231A3C" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M8 -90 q5 0 4 6 q-1 4 -5 3" fill="#B97A50" stroke="${OUTLINE}" stroke-width="1.3"/>
          <ellipse class="worker-eye" cx="-7" cy="-90" rx="1.8" ry="2.5" fill="#12133A"/>
          <path d="M-11 -96 Q-7 -98 -3 -96" fill="none" stroke="#231A3C" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M-11 -79 Q-7 -77 -4 -79" fill="none" stroke="#7E4A32" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>

      <!-- Leg on the near side, which the laptop rests on -->
      ${bar('M4 -11 L-30 -46 L-51 -7', 17, '#4A58A8')}
      <path d="M-60 -9 q-3 -8 9 -9 l9 7 l-2 9 l-17 0 q-4 -2 1 -7z" fill="#EEE6F2" stroke="${OUTLINE}" stroke-width="1.7"/>

      <!-- Far arm, behind the laptop -->
      <g class="worker-typing worker-typing-b">${bar('M-12 -44 L-34 -53', 8, '#D96F55')}<circle cx="-36" cy="-54" r="4.4" fill="#B97A50" stroke="${OUTLINE}" stroke-width="1.3"/></g>

      <!-- Laptop -->
      <path d="M-55 -56 L-31 -47 L-6 -33 L-30 -42Z" fill="#A9A5D8" stroke="${OUTLINE}" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M-43 -48 L-27 -42 M-38 -45 L-21 -39 M-33 -41 L-17 -36" stroke="#6E6AA8" stroke-width="1.5" stroke-linecap="round"/>
      <g transform="matrix(.74 .22 .34 1.16 -68 -100)">
        <rect x="-2.5" y="-2.5" width="45" height="39" rx="3" fill="#C9C6EC" stroke="${OUTLINE}" stroke-width="1.5"/>
        <rect width="40" height="34" rx="1.5" fill="#101C46"/>
        <clipPath id="workerScreen"><rect width="40" height="34"/></clipPath>
        <g clip-path="url(#workerScreen)"><g class="worker-code">${lineSet(3)}${lineSet(47)}</g></g>
        <rect width="40" height="34" rx="1.5" fill="#7FE8D6" class="worker-flicker"/>
      </g>

      <!-- Near arm, with hand on the keys -->
      <path d="M16 -68 C24 -60 18 -44 3 -38" fill="none" stroke="${OUTLINE}" stroke-width="15.4" stroke-linecap="round"/>
      <path d="M16 -68 C24 -60 18 -44 3 -38" fill="none" stroke="#F08A6C" stroke-width="12" stroke-linecap="round"/>
      <g class="worker-typing">${bar('M3 -38 L-17 -38', 9, '#F08A6C')}<circle cx="-20" cy="-38" r="4.8" fill="#CC9064" stroke="${OUTLINE}" stroke-width="1.4"/></g>

      <!-- Coffee -->
      <g transform="translate(41 -2)">
        <g class="worker-steam-set">
          <path class="worker-steam" d="M-3 -19 q-5 -6 0 -12 q5 -6 0 -12" fill="none" stroke="#FFF3E4" stroke-width="2.3" stroke-linecap="round"/>
          <path class="worker-steam worker-steam-2" d="M3 -19 q5 -6 0 -12 q-5 -6 0 -12" fill="none" stroke="#FFF3E4" stroke-width="2.3" stroke-linecap="round"/>
        </g>
        <path d="M9 -13 h3 a4 4 0 0 1 0 8 h-3" fill="none" stroke="${OUTLINE}" stroke-width="5"/>
        <path d="M9 -13 h3 a4 4 0 0 1 0 8 h-3" fill="none" stroke="#FFF3E4" stroke-width="2.4"/>
        <path d="M-10 -16 L10 -16 L8 0 Q0 3 -8 0Z" fill="#FFF3E4" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>
        <ellipse cx="0" cy="-16" rx="10" ry="3" fill="#FFF3E4" stroke="${OUTLINE}" stroke-width="1.6"/>
        <ellipse cx="0" cy="-15.6" rx="7.4" ry="1.9" fill="#5A3322"/>
      </g>`;
  })();

  // Grow window: each limb finishes on the day its skill first shows up.
  edges.forEach((e) => {
    const parent = e.n.parent === 'root' ? rootNode : byId[e.n.parent];
    const parentDate = parent.date ?? START;
    if (e.n.locked) { e.start = END - DAY; e.finish = END; return; }
    const finish = e.n.date;
    e.finish = finish;
    e.start = Math.min(finish - DAY * 2.5, Math.max(parentDate, finish - DAY * 8));
  });

  // Time and growth
  let T = END;
  let playing = false, playClock = 0;
  const PLAY_SECONDS = 17;
  const progressText = document.getElementById('progress-text');
  const xpFill = document.getElementById('xp-fill');
  const dateOut = document.getElementById('date');
  const scrub = document.getElementById('scrub');
  const playBtn = document.getElementById('play');
  const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function applyTime(next, withBursts) {
    const prev = T; T = next;
    edges.forEach((e) => {
      const raw = (T - e.start) / (e.finish - e.start);
      const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      if (t === e.t) return;
      e.t = t;
      if (e.locked) { e.locked.setAttribute('opacity', t >= 1 ? .7 : 0); return; }
      e.bark.setAttribute('d', t > 0 ? limb(e, t) : '');
      e.light.setAttribute('d', t > 0 ? limb(e, t, .2, e.p3.x < e.p0.x ? .42 : -.42) : '');
      const growing = t > 0 && t < 1;
      e.grow.setAttribute('opacity', growing ? 1 : 0);
      if (growing) {
        e.grow.style.strokeDashoffset = e.len * (1 - t);
        if (withBursts && Math.random() < .35) { const tip = bez(e, t); FX.spark(tip.x, tip.y, color[e.n.branch]); }
      }
      e.flow.setAttribute('opacity', t >= 1 ? .95 : 0);
    });
    let unlocked = 0;
    nodes.forEach((n) => {
      if (n.locked) {
        const show = T >= END - DAY / 2;
        n.inner.classList.toggle('shown', show);
        return;
      }
      const lit = T >= n.date;
      if (lit && n.kind === 'skill') unlocked++;
      if (lit !== n.el.classList.contains('lit')) {
        n.el.classList.toggle('lit', lit);
        if (lit && withBursts && next > prev) FX.burst(n.x, n.y, color[n.branch], n.hub ? 46 : 26 + (n.level || 0) * 4);
      }
    });
    const count = timeMs.filter((d) => d <= T).length;
    progressText.textContent = T >= END
      ? `${stats.skills} skills, from ${stats.commits} commits and ${stats.merges} merges. ${WALLPAPER || STILL ? '' : 'Click any stone for the proof.'}`
      : `${unlocked} of ${stats.skills} skills so far, from ${count} commits.`;
    xpFill.style.width = `${(unlocked / stats.skills) * 100}%`;
    dateOut.textContent = fmtDate(Math.min(T, ms(stats.to)));
    scrub.value = Math.round(((T - START) / (END - START)) * 1000);
  }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Replay the climb';
  }
  playBtn.addEventListener('click', () => {
    if (playing) { setPlaying(false); return; }
    if (T >= END) applyTime(START, false);
    playClock = performance.now();
    setPlaying(true);
  });
  scrub.addEventListener('input', () => {
    setPlaying(false);
    applyTime(START + (scrub.value / 1000) * (END - START), false);
  });

  // Camera
  const camera = { x: 0, y: 0, s: 1 };
  const goal = { x: 0, y: 0, s: 1 };
  let fitScale = 1, userMoved = false;
  const fitView = () => {
    const vw = innerWidth, vh = innerHeight;
    if (vw < 760) {
      const s = Math.max((vh - 150) / WORLD.h, .42);
      return { s, x: vw / 2 - 1000 * s, y: vh - 30 - WORLD.h * s };
    }
    if (STILL || WALLPAPER) {
      // A wallpaper keeps clear of the taskbar. A lock-screen picture also keeps clear of the Windows clock.
      const bottom = vh - (STILL ? 96 : 54);
      const top = STILL ? vh * .3 : 8;
      // The wallpaper sits a little further back than a tight fit, with more sky and mountains around it.
      const fitted = Math.min(vw / WORLD.w, (bottom - top) / 1030) * (WALLPAPER ? .86 : 1);
      return { s: fitted, x: (vw - WORLD.w * fitted) / 2, y: bottom - 1070 * fitted };
    }
    const barTop = vh - 74;
    const titleBottom = document.querySelector('.hud-title').getBoundingClientRect().bottom;
    const s = Math.min(vw / WORLD.w, (barTop - 8) / 1030, (barTop - titleBottom - 6) / 945);
    return { s, x: (vw - WORLD.w * s) / 2, y: barTop - 1070 * s };
  };
  const setGoal = (g, instant) => { Object.assign(goal, g); if (instant || reduced) Object.assign(camera, g); };
  function fit(instant) {
    const v = fitView(); fitScale = v.s; userMoved = false; setGoal(v, instant);
  }
  const applyCamera = () => cam.setAttribute('transform', `translate(${camera.x.toFixed(2)} ${camera.y.toFixed(2)}) scale(${camera.s.toFixed(4)})`);

  function zoomAt(factor, cx, cy) {
    const s = Math.min(Math.max(goal.s * factor, fitScale * .75), 2.6);
    const k = s / goal.s;
    userMoved = true;
    setGoal({ s, x: cx - (cx - goal.x) * k, y: cy - (cy - goal.y) * k });
  }
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0013), e.clientX, e.clientY); }, { passive: false });
  document.getElementById('zoom-in').addEventListener('click', () => zoomAt(1.25, innerWidth / 2, innerHeight / 2));
  document.getElementById('zoom-out').addEventListener('click', () => zoomAt(.8, innerWidth / 2, innerHeight / 2));
  document.getElementById('zoom-fit').addEventListener('click', () => fit(false));

  const pointers = new Map();
  let dragMoved = false, pinchDist = 0, dragStart = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const next = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, next);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist) zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist = d; dragMoved = true;
      return;
    }
    if (dragStart && Math.hypot(next.x - dragStart.x, next.y - dragStart.y) > 5) {
      dragMoved = true; userMoved = true;
      svg.classList.add('dragging');
    }
    if (dragMoved) { goal.x += next.x - prev.x; goal.y += next.y - prev.y; camera.x = goal.x; camera.y = goal.y; }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) { svg.classList.remove('dragging'); dragStart = null; }
    pinchDist = 0;
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  svg.addEventListener('click', () => { if (!dragMoved) closePanel(); });
  addEventListener('resize', () => { if (!userMoved) fit(true); });

  // Side panel
  const panel = document.getElementById('panel');
  const panelBody = document.getElementById('panel-body');
  let selected = null, returnFocus = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const longDate = (d) => fmtDate(ms(d));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pips = (level) => `<span class="pips" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;
  const copyButton = (text, label) => `<button class="copy" type="button" data-copy="${esc(text)}">${label}</button>`;
  const branchName = (id) => branches.find((b) => b.id === id).name;

  function skillHTML(n) {
    if (n.locked) {
      return `<h2>${esc(n.name)}</h2><p class="branch-name">${esc(branchName(n.branch))}</p>
        <div class="level">${pips(0)} Not unlocked yet</div>
        <p>${esc(n.about)}</p>
        <p class="note">None of your commits in this project touch this. That only covers this project, so if you have used it elsewhere, it still counts on your CV.</p>`;
    }
    const proof = n.evidence.map((c) => `<li><span class="when">${longDate(c.d)}, ${esc(c.p || 'WBT Command HQ')}, commit ${esc(c.h)}</span>${esc(c.s)}</li>`).join('');
    const countsText = n.id === 'versioncontrol'
      ? `${plural(n.commits, 'merge')}, first on ${longDate(n.first)}`
      : `${plural(n.commits, 'commit')} and ${plural(n.files, 'file')}, first on ${longDate(n.first)}`;
    return `<h2>${esc(n.name)}</h2><p class="branch-name">${esc(branchName(n.branch))}</p>
      <div class="level">${pips(n.level)} Level ${n.level} of 5</div>
      <p>${esc(n.about)}</p>
      <h3>Tools used</h3>
      <p>${esc((n.tools || []).join(', '))}</p>
      <h3>Line for your CV</h3>
      <p class="cv-line">${esc(n.cv)}</p>
      ${copyButton(n.cv, 'Copy this line')}
      <h3>Proof</h3>
      <p class="counts">${countsText}</p>
      <ul class="proof">${proof}</ul>`;
  }
  function hubHTML(n) {
    const kids = nodes.filter((k) => k.branch === n.id && k.kind === 'skill');
    const rows = kids.map((k) => `<button class="skill-link" type="button" data-open="${k.id}"><span>${esc(k.name)}</span>${k.locked ? '<span>Locked</span>' : pips(k.level)}</button>`).join('');
    return `<h2>${esc(n.name)}</h2><p class="branch-name">${plural(kids.length, 'skill')} on this branch</p>${rows}`;
  }
  function rootHTML() {
    return `<h2>Gaurav</h2><p class="branch-name">Every commit under your own name in WBT Command HQ, Deligro and Orbis</p>
      <dl class="facts">
        <dt>Commits</dt><dd>${stats.commits}</dd>
        ${(stats.projects || []).map((p) => `<dt>In ${esc(p.name)}</dt><dd>${p.commits}</dd>`).join('')}
        <dt>Merges</dt><dd>${stats.merges}</dd>
        <dt>Days with a commit</dt><dd>${stats.activeDays}</dd>
        <dt>First and last commit</dt><dd>${longDate(stats.from)} to ${longDate(stats.to)}</dd>
        <dt>Files changed</dt><dd>${stats.files.toLocaleString('en-GB')}</dd>
        <dt>Test files changed</dt><dd>${stats.testFiles}</dd>
        <dt>Database change files</dt><dd>${stats.sqlFiles}</dd>
      </dl>
      <h3>How levels work</h3>
      <p>A level shows how much proof backs a skill: the number of commits, plus a bonus for commits that changed many files. It shows how often you did something, not how expert you are.</p>
      <h3>What was left out</h3>
      <p class="note">Commit c23d0fff is not counted as proof. It swept in 2,564 files, most of them other people's work. Work by other people is not counted either, only commits under your own names (gauravmirjha and whiteslam). Commits under the shared wbt-web-support account and the NJ-28 computer's name are left out, even in your own projects.</p>`;
  }
  // Named products only, for the Tools line of a CV. Techniques stay inside their skill.
  const TOOL_NAMES = ['Next.js (App Router)', 'React', 'TypeScript', 'JavaScript', 'Node.js', 'Tailwind CSS', 'Tiptap', 'Supabase', 'PostgreSQL', 'SQL', 'Zod', 'Vercel AI SDK', 'Vitest', 'Git', 'GitHub', 'Claude Code', 'Cursor', 'Flutter', 'Dart', 'Android', 'Riverpod', 'Zustand', 'Recharts', 'Playwright', 'GitHub Actions', 'Razorpay', 'OneSignal', 'Upstash Redis', 'Anthropic API'];
  function cvHTML() {
    const groups = branches.map((b) => {
      const items = nodes.filter((n) => n.branch === b.id && n.kind === 'skill' && !n.locked).sort((x, y) => y.level - x.level);
      return `<div class="cv-group"><h3>${esc(b.name)}</h3><ul>${items.map((n) => `<li>${esc(n.cv)}</li>`).join('')}</ul></div>`;
    }).join('');
    const plain = branches.map((b) => `${b.name}\n${nodes.filter((n) => n.branch === b.id && n.kind === 'skill' && !n.locked).sort((x, y) => y.level - x.level).map((n) => `- ${n.cv}`).join('\n')}`).join('\n\n');
    const skillRows = branches.map((b) => ({ name: b.name, list: nodes.filter((n) => n.branch === b.id && n.kind === 'skill' && !n.locked).sort((x, y) => y.level - x.level).map((n) => n.name).join(', ') }));
    const toolList = [...new Set(nodes.flatMap((n) => n.tools || []))].filter((t) => TOOL_NAMES.includes(t)).join(', ');
    const skillText = `${skillRows.map((r) => `${r.name}: ${r.list}`).join('\n')}\nTools: ${toolList}`;
    return `<h2>My CV list</h2>
      <h3>Skills section</h3>
      ${skillRows.map((r) => `<p><strong>${esc(r.name)}:</strong> ${esc(r.list)}</p>`).join('')}
      <p><strong>Tools:</strong> ${esc(toolList)}</p>
      ${copyButton(skillText, 'Copy skills section')}
      <h3>Lines for your experience section</h3>
      <p class="branch-name">Pick the lines that fit the job, and keep to the strongest few.</p>
      ${copyButton(plain, 'Copy all lines')}
      ${groups}
      <h3>Before you send it</h3>
      <p class="note">${stats.claude} of your ${stats.commits} commits list Claude as co-author. Be ready to explain in an interview how each skill was used and why. Check every line against what you remember doing, and that your employer is happy for you to describe internal work.</p>`;
  }

  function showPanel(html, accent, focusNode) {
    panelBody.innerHTML = html;
    panel.style.setProperty('--accent', accent);
    panel.classList.add('open');
    document.body.classList.add('panel-open');
    panel.setAttribute('aria-hidden', 'false');
    panel.scrollTop = 0;
    if (focusNode) focusCamera(focusNode);
  }
  function focusCamera(n) {
    const panelW = innerWidth < 760 ? 0 : panel.offsetWidth;
    const visibleH = innerWidth < 760 ? innerHeight * .11 : innerHeight / 2;
    const s = Math.max(goal.s, fitScale);
    let screenX = n.x * goal.s + goal.x, screenY = n.y * goal.s + goal.y;
    const areaW = innerWidth - panelW;
    const safe = n.r * goal.s + 90;
    if (s === goal.s && screenX > safe && screenX < areaW - safe && screenY > 150 && innerWidth >= 760) return;
    screenX = areaW / 2; screenY = visibleH;
    goal.s = s;
    goal.x = screenX - n.x * s;
    goal.y = screenY - n.y * s;
    if (reduced) Object.assign(camera, goal);
  }
  function select(n) {
    if (selected) selected.el.classList.remove('selected');
    selected = n;
    n.el.classList.add('selected');
    returnFocus = n.el;
    const accent = n.branch ? color[n.branch] : '#FFD27A';
    if (!n.locked) FX.burst(n.x, n.y, accent, 20);
    const html = n.kind === 'root' ? rootHTML() : n.hub ? hubHTML(n) : skillHTML(n);
    showPanel(html, accent, n);
  }
  function closePanel() {
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    panel.setAttribute('aria-hidden', 'true');
    if (selected) selected.el.classList.remove('selected');
    selected = null;
    if (!userMoved) fit(false);
    if (returnFocus) { returnFocus.focus({ preventScroll: true }); returnFocus = null; }
  }
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('cv-open').addEventListener('click', (e) => {
    if (selected) selected.el.classList.remove('selected');
    selected = null;
    returnFocus = e.currentTarget;
    showPanel(cvHTML(), '#FFD27A');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  panelBody.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { select(byId[open.dataset.open]); return; }
    const copy = e.target.closest('[data-copy]');
    if (!copy) return;
    const original = copy.textContent;
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed. Select the text instead.';
    }
    setTimeout(() => { copy.textContent = original; }, 1600);
  });

  // Particles above the tree: fireflies, sparks, bursts and drifting petals.
  const FX = (() => {
    const canvas = document.getElementById('fx');
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0;
    const size = () => {
      const dpr = WALLPAPER ? 1 : Math.min(devicePixelRatio || 1, 1.5);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size(); addEventListener('resize', size);
    const glowCache = {};
    const glow = (c) => {
      if (glowCache[c]) return glowCache[c];
      const s = document.createElement('canvas'); s.width = s.height = 32;
      const x = s.getContext('2d');
      const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, '#fff'); g.addColorStop(.18, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 32, 32);
      return (glowCache[c] = s);
    };
    const flies = Array.from({ length: reduced ? 0 : WALLPAPER ? 18 : 42 }, () => ({
      x: Math.random(), y: .28 + Math.random() * .68, seed: Math.random() * 40, r: 5 + Math.random() * 9,
      c: Math.random() < .7 ? '#FFD27A' : branches[Math.floor(Math.random() * branches.length)].color,
    }));
    const bits = [], petals = [];
    let beadPaths = null;
    const buildBeads = () => {
      const path = (e, c, isLit) => {
        const pts = [];
        let len = 0;
        for (let i = 0; i <= 30; i++) {
          const p = bez(e, i / 30);
          if (i) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
          pts.push(p);
        }
        return { pts, len, c, isLit, phase: Math.random() * 118 };
      };
      return [path(trunkEdge, '#FFD27A', () => true), ...edges.filter((e) => !e.locked).map((e) => path(e, color[e.n.branch], () => e.t >= 1))];
    };
    let nextPetal = 0;
    return {
      spark(x, y, c) { if (!reduced && bits.length < 300) bits.push({ x, y, vx: (Math.random() - .5) * 30, vy: -10 - Math.random() * 40, life: 0, max: .5 + Math.random() * .4, c, size: 7 }); },
      burst(x, y, c, amount) {
        if (reduced) return;
        bits.push({ ring: true, x, y, life: 0, max: .7, c });
        for (let i = 0; i < amount && bits.length < 420; i++) {
          const a = Math.random() * 6.28, sp = 50 + Math.random() * 230;
          bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: .55 + Math.random() * .75, c, size: 7 + Math.random() * 10, gravity: 190 });
        }
      },
      draw(t, dt) {
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        const toX = (x) => x * camera.s + camera.x, toY = (y) => y * camera.s + camera.y;
        flies.forEach((f) => {
          const x = f.x * w + Math.sin(t * .23 + f.seed) * 90 + Math.sin(t * .71 + f.seed * 2) * 26;
          const y = f.y * h + Math.cos(t * .31 + f.seed) * 44;
          ctx.globalAlpha = Math.pow(Math.max(0, Math.sin(t * .9 + f.seed)), 2) * .95;
          ctx.drawImage(glow(f.c), x - f.r, y - f.r, f.r * 2, f.r * 2);
        });
        for (let i = bits.length - 1; i >= 0; i--) {
          const b = bits[i];
          b.life += dt;
          if (b.life >= b.max) { bits.splice(i, 1); continue; }
          const p = b.life / b.max;
          if (b.ring) {
            ctx.globalAlpha = (1 - p) * .9;
            ctx.strokeStyle = b.c; ctx.lineWidth = 3 * (1 - p) + .5;
            ctx.beginPath(); ctx.arc(toX(b.x), toY(b.y), (20 + p * 130) * camera.s, 0, 7); ctx.stroke();
            continue;
          }
          b.vy += (b.gravity || 40) * dt; b.vx *= .985;
          b.x += b.vx * dt; b.y += b.vy * dt;
          const s = b.size * (1 - p * .6) * Math.max(camera.s, .7);
          ctx.globalAlpha = 1 - p;
          ctx.drawImage(glow(b.c), toX(b.x) - s, toY(b.y) - s, s * 2, s * 2);
        }
        if (WALLPAPER && !reduced) {
          beadPaths = beadPaths || buildBeads();
          ctx.globalAlpha = .95;
          for (const b of beadPaths) {
            if (!b.isLit()) continue;
            for (let d = (t * 35 + b.phase) % 118; d < b.len; d += 118) {
              const p = b.pts[Math.round((d / b.len) * 30)];
              const size = 5 * Math.max(camera.s, .7);
              ctx.drawImage(glow(b.c), toX(p.x) - size, toY(p.y) - size, size * 2, size * 2);
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        if (!reduced && t > nextPetal) {
          nextPetal = t + .55 + Math.random() * .8;
          const lit = nodes.filter((n) => n.el.classList.contains('lit'));
          if (lit.length && petals.length < (WALLPAPER ? 10 : 34)) {
            const n = lit[Math.floor(Math.random() * lit.length)];
            petals.push({ x: n.x + (Math.random() - .5) * 60, y: n.y, c: color[n.branch], seed: Math.random() * 9, spin: Math.random() * 6, life: 0, max: 7 + Math.random() * 5 });
          }
        }
        for (let i = petals.length - 1; i >= 0; i--) {
          const l = petals[i];
          l.life += dt;
          if (l.life >= l.max || l.y > 1095) { petals.splice(i, 1); continue; }
          l.y += 34 * dt;
          l.x += (Math.sin(t * 1.1 + l.seed) * 34 - 9) * dt;
          l.spin += dt * 1.5;
          const fade = Math.min(l.life * 2, 1) * Math.min((l.max - l.life) / 1.5, 1);
          ctx.save();
          ctx.globalAlpha = fade * .88;
          ctx.translate(toX(l.x), toY(l.y));
          ctx.rotate(l.spin);
          ctx.scale(camera.s, camera.s * (.45 + Math.abs(Math.sin(l.spin)) * .55));
          ctx.fillStyle = l.c;
          ctx.beginPath(); ctx.moveTo(0, -7); ctx.quadraticCurveTo(6, 0, 0, 7); ctx.quadraticCurveTo(-6, 0, 0, -7); ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      },
    };
  })();

  // Main loop
  let lastFrame = performance.now();
  function loop(now) {
    if (WALLPAPER && now - lastFrame < 49) { requestAnimationFrame(loop); return; }
    const dt = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
    if (playing) {
      const elapsed = now - playClock; playClock = now;
      const next = T + (END - START) * (elapsed / (PLAY_SECONDS * 1000));
      if (next >= END) { applyTime(END, true); setPlaying(false); FX.burst(FORK.x, FORK.y, '#FFD27A', 60); }
      else applyTime(next, true);
    }
    const ease = 1 - Math.pow(.0009, dt);
    camera.x += (goal.x - camera.x) * ease;
    camera.y += (goal.y - camera.y) * ease;
    camera.s += (goal.s - camera.s) * ease;
    applyCamera();
    FX.draw(now / 1000, dt);
    if (!reduced) requestAnimationFrame(loop);
  }

  // The title's text has to be in place first, because the start view leaves room for it.
  if (reduced || WALLPAPER || STILL || location.hash === '#end') {
    applyTime(END, false);
  } else {
    applyTime(START, false);
    setTimeout(() => { playClock = performance.now(); setPlaying(true); }, 700);
  }
  fit(true);
  applyCamera();
  document.fonts.ready.then(() => { if (!userMoved) { fit(true); applyCamera(); } });
  requestAnimationFrame(loop);

  // Staying current: the page watches for a newer tree and celebrates anything newly earned.
  const unlockBox = document.getElementById('unlock');
  const SEEN_KEY = 'skill-tree-announced';
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch { return []; } };
  const writeSeen = (list) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-40))); } catch { /* Only stops repeat announcements after a reload. */ } };
  const eventKey = (e) => `${e.type}:${e.id}:${e.at}`;
  const paintBanner = (e) => {
    unlockBox.style.setProperty('--accent', color[e.branch] || '#FFD27A');
    unlockBox.innerHTML = e.type === 'unlock'
      ? `<span class="unlock-kind">New skill unlocked</span><strong>${esc(e.name)}</strong>`
      : `<span class="unlock-kind">Level up</span><strong>${esc(e.name)}</strong><span class="unlock-note">Now level ${e.level} of 5</span>`;
    unlockBox.hidden = false;
  };
  function celebrate(queue) {
    if (!queue.length) { unlockBox.hidden = true; return; }
    const [e, ...rest] = queue;
    paintBanner(e);
    const n = byId[e.id];
    if (n) {
      FX.burst(n.x, n.y, color[e.branch] || '#FFD27A', 60);
      setTimeout(() => FX.burst(n.x, n.y, '#FFF3E4', 40), 350);
    }
    setTimeout(() => celebrate(rest), 9000);
  }
  async function readStatus() {
    const res = await fetch('/status.json', { cache: 'no-store' });
    return res.ok ? res.json() : null;
  }
  (async () => {
    let status = null;
    try { status = await readStatus(); } catch { /* The tree still works without live updates. */ }
    const events = status?.events || [];
    if (STILL) {
      const dayAgo = Date.now() - 24 * 3600000;
      const latest = [...events].reverse().find((e) => e.type === 'unlock' && Date.parse(e.at) > dayAgo);
      if (latest) paintBanner(latest);
      return;
    }
    const seen = readSeen();
    const recent = Date.now() - 30 * 60000;
    const fresh = events.filter((e) => Date.parse(e.at) > recent && !seen.includes(eventKey(e)));
    if (fresh.length) {
      writeSeen([...seen, ...fresh.map(eventKey)]);
      setTimeout(() => celebrate(fresh), 900);
    }
  })();
  if (!STILL) {
    setInterval(async () => {
      try {
        const status = await readStatus();
        if (status && status.version !== window.TREE.version && !panel.classList.contains('open')) location.reload();
      } catch { /* Tries again at the next check. */ }
    }, 60000);
  }
})();
