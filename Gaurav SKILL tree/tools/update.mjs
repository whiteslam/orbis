// Keeps the tree current. Reads Gaurav's commits, recalculates skills, and announces anything new.
// It only ever reads his projects (WBT, Deligro, Orbis): `git fetch` refreshes what git knows about
// GitHub, and nothing is pulled, committed or pushed. It stays silent unless a skill was unlocked or
// levelled up.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.SKILLTREE_SOURCE || join(ROOT, 'tools/source');
const PUBLIC = process.env.SKILLTREE_PUBLIC || join(ROOT, 'public');
const SKIP_GIT = Boolean(process.env.SKILLTREE_SKIP_GIT);
const NO_SYSTEM = Boolean(process.env.SKILLTREE_NO_SYSTEM);
const BANNER_HOURS = 24;

// Only his own names count. The shared wbt-web-support account and other people are left out.
const HIS_NAMES = ['gauravmirjha', 'whiteslam', 'Gaurav Mirjha'];
// Files that say nothing about skill: pictures, lock files, build output, tool folders, generated app shells.
const NOISE = [
  /(^|\/)(node_modules|\.next|build|\.dart_tool|\.claude|\.cursor|\.superpowers|\.playwright-mcp|\.hallmark|\.lighthouseci|\.perf-baseline|Pods|third_party)\//,
  /^WhatsApp /,
  /^apps\/[^/]+\/(android|ios|linux|macos|windows|web)\//,
  /\.(png|jpe?g|webp|gif|ico|lock|zip|apk|aab|ttf|otf|woff2?)$/i,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|tsconfig\.tsbuildinfo)$/,
];
const PROJECTS = [
  { id: 'wbt', repo: process.env.SKILLTREE_REPO || 'F:/WBT-Staging/WBT_CHQ', prefix: '', fetch: ['origin', 'gaurav', 'staging-gaurav'],
    refs: ['staging-gaurav', 'origin/gaurav', 'origin/staging-gaurav'], authors: ['gauravmirjha'], path: (p) => p },
  // In the two below, the same work can exist twice on different branches, so copies are counted once.
  { id: 'deligro', repo: process.env.SKILLTREE_REPO_DELIGRO || 'F:/hub26/deligro', prefix: 'deligro:', fetch: ['origin'], allBranches: true, authors: HIS_NAMES, tidy: true,
    tidyPath: (f) => f.replace(/^src\//, ''),
    path: (p) => p.replace(/^command-hq\/(lib|app|components)\//, 'src/$1/').replace(/^command-hq\//, '') },
  { id: 'orbis', repo: process.env.SKILLTREE_REPO_ORBIS || 'F:/Orbis/orbis', prefix: 'orbis:', fetch: ['origin'], allBranches: true, authors: HIS_NAMES, tidy: true,
    tidyPath: (f) => f,
    path: (p) => p.replace(/^command-hq\//, '') },
];

// What each skill looks like in the code itself. New commits are searched for these.
const CODE = ['command-hq/lib/*', 'command-hq/app/*', 'command-hq/components/*'];
const SCANS = {
  react: ['useState|useEffect|useRef|useMemo', ['command-hq/*.tsx']],
  'server-actions': ['use server', ['command-hq/*.ts', 'command-hq/*.tsx']],
  tailwind: ['className=.*(flex|grid|px-|text-)', ['command-hq/*.tsx']],
  'css-media': ['@media', ['command-hq/*.css', 'command-hq/*.tsx']],
  'tailwind-responsive': ['(sm|md|lg|xl):[a-z]', ['command-hq/*.tsx']],
  tiptap: ['tiptap', ['command-hq/*.ts', 'command-hq/*.tsx']],
  dragdrop: ['onDrop|onDragOver|dataTransfer', ['command-hq/*.tsx']],
  supabase: ['supabase|\\.from\\(', ['command-hq/lib/*', 'command-hq/app/*']],
  rls: ['row level security|create policy', ['command-hq/*.sql']],
  'sql-index': ['create index|create unique index', ['command-hq/*.sql']],
  'sql-function': ['create (or replace )?function|create trigger', ['command-hq/*.sql']],
  'ai-sdk': ["generateText|streamText|generateObject|from 'ai'|@anthropic-ai/sdk", ['command-hq/*.ts', 'command-hq/*.tsx']],
  'google-api': ['docs\\.google|googleapis', ['command-hq/lib/*', 'command-hq/app/*']],
  mocks: ['vi\\.mock|vi\\.fn', ['command-hq/tests/*']],
  totp: ['totp|authenticator|two.?factor', CODE],
  crypto: ['createCipheriv|createHmac|createHash|aes-|bcrypt|argon|timingSafeEqual|encrypt', ['command-hq/lib/*', 'command-hq/app/*']],
  rbac: ['capabilit|hasPermission|canAccess|requireRole', ['command-hq/lib/*', 'command-hq/app/*']],
  lazy: ['loading="lazy"|next/dynamic|React\\.lazy', ['command-hq/*.tsx']],
  zod: ["z\\.object|from 'zod'", ['command-hq/*.ts', 'command-hq/*.tsx']],
  ssr: ['export default async function', ['command-hq/app/*page.tsx', 'command-hq/app/*layout.tsx']],
  // Skills not earned yet. They stay hidden until the code shows them.
  realtime: ['\\.channel\\(|postgres_changes', ['command-hq/lib/*', 'command-hq/components/*']],
  email: ['sendEmail\\(|nodemailer', ['command-hq/lib/*', 'command-hq/app/*']],
  payments: ["from 'stripe'|new Stripe\\(|stripe\\.(checkout|customers|subscriptions|paymentIntents|webhooks)|@stripe/|razorpay", [...CODE, 'command-hq/*.dart']],
  i18n: ['next-intl|react-i18next|useTranslations|AppLocalizations|flutter_localizations', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.dart']],
  // Skills from the phone apps and the newer projects.
  'state-management': ['riverpod|zustand', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.dart']],
  push: ['onesignal|web-push|pushManager|firebase_messaging', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.dart']],
  geo: ['geolocator|flutter_map|leaflet|navigator\\.geolocation', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.dart']],
  ratelimit: ['ratelimit|rate.?limit', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.sql']],
  dataviz: ['recharts', ['command-hq/*.ts', 'command-hq/*.tsx']],
  a11y: ['axe-core|aria-label|aria-live', ['command-hq/*.ts', 'command-hq/*.tsx']],
  pwa: ['serviceWorker|service-worker', ['command-hq/*.ts', 'command-hq/*.tsx', 'command-hq/*.js']],
  documents: ['pdf-lib|pdfjs|exceljs|xlsx|docx', ['command-hq/*.ts', 'command-hq/*.tsx']],
};

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const gitIn = (repo, args, input) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
});
const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const writeSafely = (file, text) => { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
const readTree = (file) => {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^window\.TREE = /, '').replace(/;\s*$/, '')); } catch { return null; }
};
const readStatus = () => {
  try { return JSON.parse(readFileSync(join(PUBLIC, 'status.json'), 'utf8')); } catch { return null; }
};

// Saves one project's records in its own folder. If a project can't be read (say its folder moved),
// its last saved records stay, so its stones don't vanish from the tree.
function collectProject(project) {
  const git = (args, input) => gitIn(project.repo, args, input);
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    log(`Could not open ${project.id} at ${project.repo}, so its last saved commits are kept.`);
    return false;
  }
  try {
    git(['fetch', ...project.fetch, '--quiet']);
  } catch {
    log(`Could not reach GitHub for ${project.id}, so this check only sees commits already on this computer.`);
  }
  let refs;
  if (project.allBranches) {
    refs = ['--branches', '--remotes=origin'];
  } else {
    refs = project.refs.filter((r) => { try { git(['rev-parse', '--verify', '-q', r]); return true; } catch { return false; } });
    if (!refs.length) { log(`None of the branches could be found in ${project.id}.`); return false; }
  }
  const dir = join(SOURCE, 'projects', project.id);
  mkdirSync(dir, { recursive: true });
  const id = (h) => `${project.prefix}${h}`;
  const base = ['log', ...refs, ...project.authors.map((a) => `--author=${a}`), '--abbrev=8', '--date=short'];
  const lines = (text) => text.split(/\r?\n/).filter(Boolean);

  const kept = new Set();
  const copies = new Set();
  const commits = [];
  for (const line of lines(git([...base, '--no-merges', '--format=%h|%at|%ad|%s']))) {
    const [h, at, d, ...rest] = line.split('|');
    const s = rest.join('|');
    if (project.allBranches) {
      if (copies.has(`${at}|${s}`)) continue;
      copies.add(`${at}|${s}`);
    }
    kept.add(h);
    commits.push(`${id(h)}|${d}|${s}`);
  }
  writeSafely(join(dir, 'commits.txt'), commits.length ? `${commits.join('\n')}\n` : '');

  const merges = lines(git([...base, '--merges', '--format=%h|%ad|%s'])).map((l) => `${project.prefix}${l}`);
  writeSafely(join(dir, 'merges.txt'), merges.length ? `${merges.join('\n')}\n` : '');

  const files = [];
  let keep = false;
  for (const line of lines(git([...base, '--no-merges', '--format=@%h', '--name-only']))) {
    if (/^@[0-9a-f]{7,}$/.test(line)) {
      keep = kept.has(line.slice(1));
      if (keep) files.push(`@${id(line.slice(1))}`);
    } else if (keep && !(project.tidy && NOISE.some((re) => re.test(line)))) {
      files.push(project.tidy ? project.tidyPath(line) : line);
    }
  }
  writeSafely(join(dir, 'commit-files.txt'), files.length ? `${files.join('\n')}\n` : '');

  let hash = null;
  const coauthored = new Set();
  for (const line of git([...base, '--no-merges', '--format=@%h%n%b']).split(/\r?\n/)) {
    if (/^@[0-9a-f]{7,}$/.test(line)) hash = line.slice(1);
    else if (hash && kept.has(hash) && /co-authored-by: claude/i.test(line)) coauthored.add(id(hash));
  }
  writeSafely(join(dir, 'coauthored-claude.txt'), coauthored.size ? `${[...coauthored].sort().join('\n')}\n` : '');
  return true;
}

function refreshCommits() {
  const readable = PROJECTS.filter((p) => collectProject(p));
  if (!readable.length) throw new Error('None of the projects could be read.');
  for (const name of ['commits.txt', 'merges.txt', 'commit-files.txt', 'coauthored-claude.txt']) {
    const all = PROJECTS.flatMap((p) => readLines(join(SOURCE, 'projects', p.id, name)));
    writeSafely(join(SOURCE, name), `${all.join('\n')}\n`);
  }

  // Only commits not looked at before are searched, so most checks finish in seconds. A search that is
  // new or has changed looks through every commit once. If one search fails, the others still run, and
  // the failed one tries everything again next time.
  const evidence = join(SOURCE, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const seenFile = join(evidence, '_seen.txt');
  const scansFile = join(evidence, '_scans.txt');
  const seen = new Set(readLines(seenFile));
  const done = new Set(readLines(scansFile));
  let freshTotal = 0;
  for (const project of readable) {
    const all = readLines(join(SOURCE, 'projects', project.id, 'commits.txt')).map((l) => l.split('|')[0]);
    const fresh = all.filter((h) => !seen.has(h));
    freshTotal += fresh.length;
    for (const [name, [pattern, paths]] of Object.entries(SCANS)) {
      const key = `${project.id}/${name}@${createHash('sha1').update(pattern + paths.join()).digest('hex').slice(0, 10)}`;
      const toSearch = done.has(key) ? fresh : all;
      if (!toSearch.length) { done.add(key); continue; }
      const raw = toSearch.map((h) => h.slice(project.prefix.length));
      try {
        const found = gitIn(project.repo, ['log', '--no-walk', '--stdin', '-i', `-G${pattern}`, '--abbrev=8', '--format=%h', '--', ...paths.map(project.path)], `${raw.join('\n')}\n`)
          .split(/\r?\n/).filter(Boolean).map((h) => `${project.prefix}${h}`);
        if (found.length) {
          const file = join(evidence, `${name}.txt`);
          writeSafely(file, `${[...new Set([...readLines(file), ...found])].join('\n')}\n`);
        }
        done.add(key);
      } catch {
        log(`The ${name} search failed in ${project.id}, and will try again next time.`);
        done.delete(key);
      }
    }
    for (const h of fresh) seen.add(h);
  }
  writeSafely(scansFile, `${[...done].join('\n')}\n`);
  writeSafely(seenFile, `${[...seen].join('\n')}\n`);
  return freshTotal;
}

function compare(before, after) {
  if (!before) return [];
  const old = Object.fromEntries(before.nodes.filter((n) => n.kind === 'skill').map((n) => [n.id, n]));
  const at = new Date().toISOString();
  const events = [];
  for (const n of after.nodes.filter((x) => x.kind === 'skill')) {
    if (!old[n.id]) events.push({ type: 'unlock', id: n.id, name: n.name, branch: n.branch, level: n.level, at });
    else if (n.level > old[n.id].level) events.push({ type: 'levelup', id: n.id, name: n.name, branch: n.branch, level: n.level, at });
  }
  return events;
}

function findBrowser() {
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
}

function powershell(script, ...args) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'tools', script), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  if (r.status !== 0) throw new Error(`${script}: ${(r.stderr || r.stdout || 'failed').trim().slice(0, 300)}`);
  return r.stdout.trim();
}

function drawPicture(address, picture) {
  const browser = findBrowser();
  if (!browser) throw new Error('No browser found to draw the picture.');
  const profile = join(tmpdir(), 'gaurav-skill-tree-render');
  const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1920,1080', '--virtual-time-budget=6000', `--screenshot=${picture}`, address], {
    windowsHide: true, timeout: 90000,
  });
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  if (r.status !== 0 || !existsSync(picture)) throw new Error(`The picture ${picture} could not be drawn.`);
}

function refreshLockScreen() {
  const picture = join(ROOT, 'tools/lockscreen.png');
  drawPicture('http://localhost:3000/?still=1', picture);
  return powershell('set-lockscreen.ps1', picture);
}

function refreshWallpaperSnapshot() {
  const temporary = join(PUBLIC, 'wallpaper-new.png');
  drawPicture('http://localhost:3000/?wallpaper=1', temporary);
  renameSync(temporary, join(PUBLIC, 'wallpaper.png'));
}

function main() {
  const fresh = SKIP_GIT ? 0 : refreshCommits();
  const before = readTree(join(PUBLIC, 'data.js'));
  const build = spawnSync(process.execPath, [join(ROOT, 'tools/build-data.mjs')], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, SKILLTREE_SOURCE: SOURCE, SKILLTREE_PUBLIC: PUBLIC },
  });
  if (build.status !== 0) throw new Error(`Rebuild failed: ${(build.stderr || '').trim().slice(0, 500)}`);
  const after = readTree(join(PUBLIC, 'data.js'));
  if (!after) throw new Error('The rebuilt tree could not be read.');

  const previous = readStatus();
  const events = compare(before, after);
  const history = [...(previous?.events || []), ...events].slice(-30);
  const dayAgo = Date.now() - BANNER_HOURS * 3600000;
  const banner = [...history].reverse().find((e) => e.type === 'unlock' && Date.parse(e.at) > dayAgo) || null;
  const levels = after.nodes.filter((n) => n.kind === 'skill').map((n) => `${n.id}:${n.level}`).join(',');
  const lockKey = createHash('sha1').update(`${levels}|${banner ? banner.id + banner.at : ''}`).digest('hex');

  const status = {
    version: after.version,
    updatedAt: new Date().toISOString(),
    commits: after.stats.commits,
    skills: after.stats.skills,
    events: history,
    lockKey: previous?.lockKey || null,
    lockError: previous?.lockError || null,
  };
  writeSafely(join(PUBLIC, 'status.json'), JSON.stringify(status, null, 2));

  if (!NO_SYSTEM && !process.env.SKILLTREE_SKIP_LOCK && status.lockKey !== lockKey) {
    try {
      log(refreshLockScreen());
      status.lockKey = lockKey;
      status.lockError = null;
    } catch (err) {
      status.lockError = err.message;
      log('Lock screen not updated:', err.message);
    }
    writeSafely(join(PUBLIC, 'status.json'), JSON.stringify(status, null, 2));
  }

  if (!NO_SYSTEM && !process.env.SKILLTREE_SKIP_LOCK && (before?.version !== after.version || !existsSync(join(PUBLIC, 'wallpaper.png')))) {
    try { refreshWallpaperSnapshot(); } catch (err) { log('Wallpaper snapshot not updated:', err.message); }
  }

  if (!NO_SYSTEM) {
    for (const e of events.filter((x) => x.type === 'unlock').slice(0, 3)) {
      try { powershell('notify.ps1', 'New skill unlocked', e.name); } catch (err) { log('Notification not shown:', err.message); }
    }
  }
  log(`Checked: ${after.stats.commits} commits, ${fresh} new, ${after.stats.skills} skills, ${events.length} announcements.`);
  for (const e of events) log(e.type === 'unlock' ? `Unlocked: ${e.name}` : `Level up: ${e.name} is now level ${e.level}`);
}

try {
  main();
} catch (err) {
  log('Update failed, keeping the tree as it was:', err.message);
  process.exitCode = 1;
}
