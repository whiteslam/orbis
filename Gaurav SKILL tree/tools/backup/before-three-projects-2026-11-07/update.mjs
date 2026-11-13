// Keeps the tree current. Reads Gaurav's commits, recalculates skills, and announces anything new.
// It only ever reads the WBT project: `git fetch` refreshes what git knows about GitHub, and nothing
// is pulled, committed or pushed. It stays silent unless a skill was unlocked or levelled up.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.SKILLTREE_REPO || 'F:/WBT-Staging/WBT_CHQ';
const SOURCE = process.env.SKILLTREE_SOURCE || join(ROOT, 'tools/source');
const PUBLIC = process.env.SKILLTREE_PUBLIC || join(ROOT, 'public');
const SKIP_GIT = Boolean(process.env.SKILLTREE_SKIP_GIT);
const NO_SYSTEM = Boolean(process.env.SKILLTREE_NO_SYSTEM);
const AUTHOR = 'gauravmirjha';
const REFS = ['staging-gaurav', 'origin/gaurav', 'origin/staging-gaurav'];
const BANNER_HOURS = 24;

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
  'ai-sdk': ["generateText|streamText|generateObject|from 'ai'", ['command-hq/*.ts', 'command-hq/*.tsx']],
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
  payments: ["from 'stripe'|new Stripe\(|stripe\.(checkout|customers|subscriptions|paymentIntents|webhooks)|@stripe/", CODE],
  i18n: ['next-intl|react-i18next|useTranslations', ['command-hq/*.ts', 'command-hq/*.tsx']],
};

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const git = (args, input) => execFileSync('git', ['-C', REPO, ...args], {
  encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
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

function refreshCommits() {
  try {
    git(['fetch', 'origin', 'gaurav', 'staging-gaurav', '--quiet']);
  } catch {
    log('Could not reach GitHub, so this check only sees commits already on this computer.');
  }
  const refs = REFS.filter((r) => { try { git(['rev-parse', '--verify', '-q', r]); return true; } catch { return false; } });
  if (!refs.length) throw new Error('None of the branches could be found.');
  const base = ['log', ...refs, `--author=${AUTHOR}`, '--abbrev=8', '--date=short'];
  writeSafely(join(SOURCE, 'commits.txt'), git([...base, '--no-merges', '--format=%h|%ad|%s']));
  writeSafely(join(SOURCE, 'merges.txt'), git([...base, '--merges', '--format=%h|%ad|%s']));
  writeSafely(join(SOURCE, 'commit-files.txt'), git([...base, '--no-merges', '--format=@%h', '--name-only']));

  let hash = null;
  const coauthored = new Set();
  for (const line of git([...base, '--no-merges', '--format=@%h%n%b']).split(/\r?\n/)) {
    if (line.startsWith('@')) hash = line.slice(1);
    else if (hash && /co-authored-by: claude/i.test(line)) coauthored.add(hash);
  }
  writeSafely(join(SOURCE, 'coauthored-claude.txt'), `${[...coauthored].sort().join('\n')}\n`);

  // Only commits not looked at before are searched, so most checks finish in seconds.
  const evidence = join(SOURCE, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const seenFile = join(evidence, '_seen.txt');
  const seen = new Set(readLines(seenFile));
  const fresh = readLines(join(SOURCE, 'commits.txt')).map((l) => l.split('|')[0]).filter((h) => !seen.has(h));
  if (!fresh.length) return 0;
  for (const [name, [pattern, paths]] of Object.entries(SCANS)) {
    const found = git(['log', '--no-walk', '--stdin', '-i', `-G${pattern}`, '--abbrev=8', '--format=%h', '--', ...paths], `${fresh.join('\n')}\n`)
      .split(/\r?\n/).filter(Boolean);
    if (!found.length) continue;
    const file = join(evidence, `${name}.txt`);
    writeSafely(file, `${[...new Set([...readLines(file), ...found])].join('\n')}\n`);
  }
  writeSafely(seenFile, `${[...seen, ...fresh].join('\n')}\n`);
  return fresh.length;
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
