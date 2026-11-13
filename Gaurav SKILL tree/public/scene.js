// The living backdrop: dusk sky, alpenglow mountains in layers, clouds, mist, stars.
(function () {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1;
  let sky, starsLayer, layers = [], cloudSprites = [], clouds = [], twinkles = [], shooting = null, nextShoot = 6;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };

  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const offscreen = (cw, ch) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(cw * dpr); c.height = Math.ceil(ch * dpr);
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    return [c, x];
  };

  // A jagged ridge line by repeatedly splitting segments and nudging the midpoint.
  function ridgeLine(rand, width, base, amp, roughness, peaks) {
    let pts = [{ x: -40, y: base }];
    for (let i = 0; i <= peaks; i++) {
      const x = ((i + .5) / (peaks + 1)) * width + (rand() - .5) * width / peaks * .55;
      pts.push({ x, y: base - amp * (.35 + rand() * .65) });
      if (i < peaks) pts.push({ x: x + width / (peaks + 1) * (.35 + rand() * .3), y: base - amp * (rand() * .22) });
    }
    pts.push({ x: width + 40, y: base });
    let spread = amp * roughness;
    for (let pass = 0; pass < 4; pass++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        next.push({ x: (a.x + b.x) / 2 + (rand() - .5) * (b.x - a.x) * .25, y: (a.y + b.y) / 2 + (rand() - .5) * spread }, b);
      }
      pts = next; spread *= .52;
    }
    return pts;
  }

  function buildRange(cfg) {
    const lw = w * 1.16, lh = h;
    const [c, x] = offscreen(lw, lh);
    const rand = rng(cfg.seed);
    const base = h * cfg.base, amp = h * cfg.amp;
    const ridge = ridgeLine(rand, lw, base, amp, cfg.rough, cfg.peaks);

    const trace = () => {
      x.beginPath(); x.moveTo(ridge[0].x, lh);
      ridge.forEach((p) => x.lineTo(p.x, p.y));
      x.lineTo(ridge[ridge.length - 1].x, lh); x.closePath();
    };
    const body = x.createLinearGradient(0, base - amp, 0, Math.min(lh, base + h * .24));
    body.addColorStop(0, cfg.top); body.addColorStop(1, cfg.bottom);
    trace(); x.fillStyle = body; x.fill();

    x.save(); trace(); x.clip();
    const win = 7;
    const summits = [];
    for (let i = win; i < ridge.length - win; i++) {
      let top = true;
      for (let j = -win; j <= win; j++) if (ridge[i + j].y < ridge[i].y) top = false;
      if (top) summits.push(i);
    }
    summits.forEach((i, k) => {
      const peak = ridge[i];
      const height = base - peak.y;
      const nextValley = k + 1 < summits.length ? Math.floor((i + summits[k + 1]) / 2) : Math.min(i + 30, ridge.length - 1);
      const prevValley = k > 0 ? Math.floor((i + summits[k - 1]) / 2) : Math.max(i - 30, 0);
      // A crooked spine running down from the summit splits the lit face from the shadow face.
      const spine = [{ x: peak.x, y: peak.y }];
      const steps = 7, drop = height + h * .1;
      for (let s = 1; s <= steps; s++) {
        const last = spine[spine.length - 1];
        spine.push({ x: last.x + (rand() - .32) * drop / steps * 1.05, y: peak.y + drop * s / steps });
      }
      // Shadow face, away from the setting sun.
      x.beginPath(); x.moveTo(peak.x, peak.y);
      for (let j = i; j <= nextValley; j++) x.lineTo(ridge[j].x, ridge[j].y);
      x.lineTo(ridge[nextValley].x + drop * .3, peak.y + drop);
      for (let s = spine.length - 1; s >= 0; s--) x.lineTo(spine[s].x, spine[s].y);
      x.closePath(); x.fillStyle = cfg.shadow; x.fill();
      // Warm light on the sunward face.
      const glow = x.createLinearGradient(peak.x, peak.y, peak.x, peak.y + height * .85);
      glow.addColorStop(0, cfg.glow); glow.addColorStop(1, 'rgba(255,170,130,0)');
      x.beginPath(); x.moveTo(peak.x, peak.y);
      for (let j = i; j >= prevValley; j--) x.lineTo(ridge[j].x, ridge[j].y);
      x.lineTo(ridge[prevValley].x - drop * .2, peak.y + drop);
      for (let s = spine.length - 1; s >= 0; s--) x.lineTo(spine[s].x, spine[s].y);
      x.closePath(); x.fillStyle = glow; x.fill();

      // Snow, jagged along its lower edge, tinted by which face it sits on.
      if (cfg.snow && height > amp * .42) {
        const line = peak.y + height * cfg.snow * (.8 + rand() * .4);
        let a = i; while (a > prevValley && ridge[a].y < line) a--;
        let b = i; while (b < nextValley && ridge[b].y < line) b++;
        const lower = [];
        const teeth = 9;
        for (let t = 0; t <= teeth; t++) {
          const px = ridge[b].x + (ridge[a].x - ridge[b].x) * t / teeth;
          lower.push({ x: px, y: line + (t % 2 ? -1 : 1) * (height * .05 + rand() * height * .07) });
        }
        const midX = peak.x + (rand() - .4) * 6;
        x.beginPath(); x.moveTo(peak.x, peak.y);
        for (let j = i; j >= a; j--) x.lineTo(ridge[j].x, ridge[j].y);
        lower.slice().reverse().forEach((p) => { if (p.x <= midX) x.lineTo(p.x, p.y); });
        x.lineTo(midX, line + height * .08); x.closePath(); x.fillStyle = cfg.snowLit; x.fill();
        x.beginPath(); x.moveTo(peak.x, peak.y);
        for (let j = i; j <= b; j++) x.lineTo(ridge[j].x, ridge[j].y);
        lower.forEach((p) => { if (p.x >= midX) x.lineTo(p.x, p.y); });
        x.lineTo(midX, line + height * .08); x.closePath(); x.fillStyle = cfg.snowDark; x.fill();
      }
    });
    x.restore();

    // Pines on the nearest ridge.
    if (cfg.pines) {
      x.fillStyle = cfg.bottom;
      for (let i = 2; i < ridge.length - 2; i += 1) {
        if (rand() > cfg.pines) continue;
        const p = ridge[i], size = h * (.022 + rand() * .034);
        for (let tier = 0; tier < 3; tier++) {
          const tw = size * (.42 - tier * .1), top = p.y - size * (1.05 + tier * .42), bot = p.y - size * (.28 + tier * .42);
          x.beginPath(); x.moveTo(p.x, top); x.lineTo(p.x - tw, bot); x.lineTo(p.x + tw, bot); x.closePath(); x.fill();
        }
      }
    }
    return { canvas: c, depth: cfg.depth };
  }

  function buildCloudSprites() {
    const rand = rng(77);
    cloudSprites = [0, 1, 2].map(() => {
      const cw = 620, ch = 170;
      const [c, x] = offscreen(cw, ch);
      x.filter = 'blur(13px)';
      for (let i = 0; i < 26; i++) {
        const t = rand();
        const cx = 70 + t * (cw - 140), spread = 1 - Math.abs(t - .5) * 1.7;
        const r = 15 + rand() * 38 * spread;
        const cy = ch * .6 - rand() * 36 * spread;
        x.fillStyle = rand() < .3 ? 'rgba(255,190,170,.5)' : 'rgba(255,226,222,.42)';
        x.beginPath(); x.ellipse(cx, cy, r * 1.7, r * .62, 0, 0, 7); x.fill();
      }
      return c;
    });
    clouds = Array.from({ length: 7 }, (_, i) => ({
      sprite: cloudSprites[i % 3],
      x: rand() * w * 1.3 - w * .15,
      y: h * (.14 + rand() * .3),
      scale: .55 + rand() * .75,
      speed: 4 + rand() * 9,
      alpha: .35 + rand() * .4,
      near: i % 2 === 0,
    }));
  }

  function build() {
    dpr = capped ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.ceil(w * dpr); canvas.height = Math.ceil(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let x;
    [sky, x] = offscreen(w, h);
    const g = x.createLinearGradient(0, 0, 0, h * .86);
    g.addColorStop(0, '#12163F'); g.addColorStop(.3, '#2A2A68'); g.addColorStop(.52, '#6A4688');
    g.addColorStop(.7, '#C96F86'); g.addColorStop(.84, '#F7A27E'); g.addColorStop(1, '#FFD49A');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const sun = x.createRadialGradient(w * .34, h * .74, 0, w * .34, h * .74, h * .62);
    sun.addColorStop(0, 'rgba(255,226,170,.8)'); sun.addColorStop(.4, 'rgba(255,170,130,.28)'); sun.addColorStop(1, 'rgba(255,170,130,0)');
    x.fillStyle = sun; x.fillRect(0, 0, w, h);

    let sx;
    [starsLayer, sx] = offscreen(w, h);
    const rand = rng(11);
    for (let i = 0; i < 240; i++) {
      const y = Math.pow(rand(), 1.7) * h * .52;
      sx.fillStyle = `rgba(255,246,235,${(.75 - y / (h * .7)) * (.35 + rand() * .65)})`;
      sx.beginPath(); sx.arc(rand() * w, y, .5 + rand() * .9, 0, 7); sx.fill();
    }
    twinkles = Array.from({ length: 34 }, () => ({ x: rand() * w, y: Math.pow(rand(), 1.5) * h * .42, r: 1 + rand() * 1.1, phase: rand() * 7, speed: .7 + rand() * 1.7 }));

    layers = [
      { seed: 21, base: .72, amp: .34, rough: .34, peaks: 6, depth: .012, top: '#C98AA6', bottom: '#8E6AA6', shadow: 'rgba(74,58,132,.5)', glow: 'rgba(255,190,150,.5)', snow: .34, snowLit: '#FFE7DD', snowDark: '#C9B4DE' },
      { seed: 5, base: .8, amp: .36, rough: .36, peaks: 5, depth: .024, top: '#7E5C9E', bottom: '#4F4686', shadow: 'rgba(38,34,98,.55)', glow: 'rgba(255,160,130,.42)', snow: .3, snowLit: '#FFEBE3', snowDark: '#A9A0D8' },
      { seed: 31, base: .89, amp: .27, rough: .3, peaks: 7, depth: .04, top: '#3F3A7A', bottom: '#29295F', shadow: 'rgba(16,18,66,.5)', glow: 'rgba(240,130,130,.2)', snow: 0 },
      { seed: 63, base: .95, amp: .09, rough: .24, peaks: 12, depth: .065, top: '#1F2155', bottom: '#14163F', shadow: 'rgba(8,10,44,.4)', glow: 'rgba(0,0,0,0)', snow: 0, pines: .34 },
    ].map(buildRange);
    buildCloudSprites();
    if (capped) {
      const [flat, f] = offscreen(w, h);
      f.drawImage(sky, 0, 0, w, h);
      f.drawImage(starsLayer, 0, 0, w, h);
      const mistAt = [.69, .8, .9];
      const mistStrength = [.4, .34, .2];
      layers.forEach((layer, i) => {
        f.drawImage(layer.canvas, -w * .08, 0, w * 1.16, h);
        if (i < 3) drawMist(0, h * mistAt[i], mistStrength[i], f);
      });
      sky = flat; starsLayer = null; layers = [];
    }
  }

  function drawClouds(near, dt) {
    clouds.forEach((c) => {
      if (c.near !== near) return;
      c.x += c.speed * dt;
      const width = 620 * c.scale;
      if (c.x > w + 40) c.x = -width - 40;
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.sprite, c.x + look.x * (near ? -14 : -7), c.y, width, 170 * c.scale);
    });
    ctx.globalAlpha = 1;
  }

  function drawMist(t, y, alpha, target = ctx) {
    const g = target.createLinearGradient(0, y - h * .08, 0, y + h * .08);
    const a = alpha * (.8 + Math.sin(t * .22 + y) * .2);
    g.addColorStop(0, 'rgba(255,205,190,0)'); g.addColorStop(.5, `rgba(255,205,190,${a})`); g.addColorStop(1, 'rgba(255,205,190,0)');
    target.fillStyle = g; target.fillRect(0, y - h * .08, w, h * .16);
  }

  // As a wallpaper the scene runs at 20 frames a second, to stay light on the computer.
  const capped = new URLSearchParams(location.search).has('wallpaper');
  let lastDrawn = 0;
  let last = performance.now();
  function frame(now) {
    if (capped && now - lastDrawn < 49) { requestAnimationFrame(frame); return; }
    lastDrawn = now;
    const t = now / 1000;
    const dt = Math.min((now - last) / 1000, .05); last = now;
    look.x += (look.tx - look.x) * .045; look.y += (look.ty - look.y) * .045;

    ctx.globalAlpha = 1;
    ctx.drawImage(sky, 0, 0, w, h);
    if (starsLayer) ctx.drawImage(starsLayer, 0, 0, w, h);

    twinkles.forEach((s) => {
      const a = .25 + .75 * Math.abs(Math.sin(t * s.speed + s.phase));
      ctx.fillStyle = `rgba(255,248,235,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    });

    if (!reduced) {
      if (t > nextShoot && !shooting) {
        shooting = { x: w * (.25 + Math.random() * .6), y: h * (.04 + Math.random() * .2), life: 0 };
        nextShoot = t + 7 + Math.random() * 9;
      }
      if (shooting) {
        shooting.life += dt;
        const p = shooting.life / .85;
        if (p >= 1) shooting = null;
        else {
          const hx = shooting.x - p * 300, hy = shooting.y + p * 120;
          const grad = ctx.createLinearGradient(hx, hy, hx + 130, hy - 52);
          grad.addColorStop(0, `rgba(255,248,235,${1 - p})`); grad.addColorStop(1, 'rgba(255,248,235,0)');
          ctx.strokeStyle = grad; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 130, hy - 52); ctx.stroke();
        }
      }
    }

    drawClouds(false, reduced ? 0 : dt);
    if (!layers.length) drawClouds(true, reduced ? 0 : dt);
    layers.forEach((layer, i) => {
      const lx = -w * .08 + look.x * w * layer.depth * -1;
      const ly = look.y * h * layer.depth * -.35;
      ctx.drawImage(layer.canvas, lx, ly, w * 1.16, h);
      if (i === 0) { drawMist(t, h * .69, .4); drawClouds(true, reduced ? 0 : dt); }
      if (i === 1) drawMist(t, h * .8, .34);
      if (i === 2) drawMist(t, h * .9, .2);
    });
    if (!reduced) requestAnimationFrame(frame);
  }

  if (!capped) addEventListener('pointermove', (e) => {
    look.tx = (e.clientX / innerWidth - .5) * 2;
    look.ty = (e.clientY / innerHeight - .5) * 2;
  });
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { build(); if (reduced) frame(performance.now()); }, 150);
  });

  build();
  requestAnimationFrame(frame);
})();
