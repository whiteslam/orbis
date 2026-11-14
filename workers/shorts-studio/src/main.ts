// The Orbis Shorts worker: runs on the owner's PC as a user service.
//   node workers/shorts-studio/src/main.ts
// Checks the skill is set up, publishes the style catalog and voices, then
// takes the owner's queued shorts one at a time. See ../README.md.

import { inWindow } from '../../../lib/shorts/shelf.ts';
import { createAutopilotDb, type BuildWindow } from './autopilot.ts';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './claude.ts';
import { loadConfig, type Config } from './config.ts';
import { createWorkerDb, type WorkerDb, type WorkerMode } from './db.ts';
import { runJob, type RunDeps } from './run.ts';
import { parseStyle, parseVoices, STYLE_ORDER, type StyleMeta } from './styles.ts';

const HEARTBEAT_MS = 30_000;
const SWEEP_MS = 5 * 60_000;
const AUTOPILOT_CHECK_MS = 60_000;
const SETUP_RETRY_MS = 10 * 60_000;
const ATTENTION_PAUSE_MS = 30 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts: unknown[]) => console.log(new Date().toISOString(), ...parts);
const readText = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

function exec(bin: string, args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', (error) => resolve({ code: null, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function readStyles(skillDir: string): { styles: StyleMeta[]; sheets: Map<string, Uint8Array> } {
  const dir = join(skillDir, 'styles');
  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z0-9-]{2,40}$/.test(entry.name) && existsSync(join(dir, entry.name, 'STYLE.md')))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const rank = (slug: string) => { const index = STYLE_ORDER.indexOf(slug); return index === -1 ? STYLE_ORDER.length : index; };
      return rank(left) - rank(right) || left.localeCompare(right);
    });
  const sheets = new Map<string, Uint8Array>();
  const styles = slugs.map((slug, position) => {
    const sheet = join(dir, slug, 'style-sheet.png');
    if (existsSync(sheet)) sheets.set(slug, readFileSync(sheet));
    return parseStyle(slug, readText(join(dir, slug, 'STYLE.md')) ?? '', readText(join(dir, slug, 'example', 'script.json')), position);
  });
  return { styles, sheets };
}

async function waitForSetup(cfg: Config, db: WorkerDb, stopped: () => boolean) {
  while (!stopped()) {
    const setup = await exec('bash', [join(cfg.skillDir, 'scripts', 'setup.sh')], cfg.skillDir);
    if (setup.output.includes('All set')) return;
    const tail = setup.output.trim().split('\n').slice(-6).join('\n');
    log('The skill isn’t set up yet:\n', tail);
    await db.heartbeat(cfg.owner, 'setup', `The faceless-shorts skill isn’t set up on your PC yet:\n${tail}`).catch((error: unknown) => log('heartbeat', error));
    await sleep(SETUP_RETRY_MS);
  }
}

async function main() {
  const cfg = loadConfig(process.env, readText);
  if (!existsSync(join(cfg.skillDir, 'SKILL.md'))) throw new Error(`The faceless-shorts skill isn’t at ${cfg.skillDir}. Set SKILL_DIR.`);
  const db = createWorkerDb(cfg.url, cfg.key);

  let stopping = false;
  let mode: WorkerMode = 'setup';
  let note: string | null = null;
  const onStop = () => { stopping = true; log('Stopping after the current step.'); };
  process.on('SIGTERM', onStop);
  process.on('SIGINT', onStop);

  await db.heartbeat(cfg.owner, 'setup', 'Checking the skill setup…');
  await waitForSetup(cfg, db, () => stopping);
  if (stopping) return;

  const { styles, sheets } = readStyles(cfg.skillDir);
  await db.syncStyles(styles, sheets);
  const threeD = new Set(styles.filter((style) => style.is3d).map((style) => style.slug));
  const voiceList = await exec(join(cfg.skillDir, 'scripts', 'py'), [join(cfg.skillDir, 'scripts', 'voice.py'), '--list'], cfg.skillDir);
  const voices = parseVoices(voiceList.output);
  log(`Synced ${styles.length} styles and ${voices.length} voices.`);

  const restarted = await db.sweep(cfg.owner, 'restart');
  if (restarted) log(`Marked ${restarted} interrupted short(s) as failed.`);

  mode = 'idle';
  await db.heartbeat(cfg.owner, mode, null, voices);
  const beat = setInterval(() => { void db.heartbeat(cfg.owner, mode, note).catch((error: unknown) => log('heartbeat', error)); }, HEARTBEAT_MS);

  const autopilot = createAutopilotDb(cfg.url, cfg.key);
  const deps: RunDeps = { db, cfg, claude: runClaude, exec, is3d: (style) => threeD.has(style), autopilot };
  let lastAutopilotCheck = 0;
  // The build window, read with each autopilot check: null while the autopilot is off.
  let buildWindow: BuildWindow | null = null;
  let lastSweep = Date.now();
  let pausedUntil = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastSweep > SWEEP_MS) {
        lastSweep = Date.now();
        const stale = await db.sweep(cfg.owner, 'stale');
        if (stale) log(`Marked ${stale} silent short(s) as failed.`);
      }
      if (Date.now() < pausedUntil) { await sleep(cfg.pollMs); continue; }
      // Once a minute: should the autopilot start its next short? It is queued like any other and taken below.
      if (Date.now() - lastAutopilotCheck > AUTOPILOT_CHECK_MS) {
        lastAutopilotCheck = Date.now();
        buildWindow = await autopilot.window(cfg.owner).catch((error: unknown) => {
          log('autopilot', error instanceof Error ? error.message : error);
          return buildWindow;
        });
        const started = await autopilot.startNext(cfg.owner, new Date()).catch((error: unknown) => {
          log('autopilot', error instanceof Error ? error.message : error);
          return null;
        });
        if (started) log(`Autopilot queued (${started.destination}): ${started.topic}`);
      }
      if (mode === 'paused') { mode = 'idle'; note = null; await db.heartbeat(cfg.owner, mode, note); }

      // Autopilot shorts are built only in the night window; a short the owner queued is taken any time.
      const autopilotNow = !buildWindow || inWindow(buildWindow.windowStart, buildWindow.windowEnd, new Date(), buildWindow.timezone);
      const job = await db.nextJob(cfg.owner, { autopilot: autopilotNow });
      if (!job || !(await db.claim(job))) { await sleep(cfg.pollMs); continue; }

      mode = 'busy';
      note = `${job.stage === 'build' ? 'Building' : 'Planning'}: ${job.topic.slice(0, 80)}`;
      await db.heartbeat(cfg.owner, mode, note);
      log(`${job.stage} ${job.id} (${job.style}): ${job.topic.slice(0, 80)}`);
      const outcome = await runJob(job, deps);
      log(`${job.id} → ${outcome}`);

      if (outcome === 'attention') {
        mode = 'paused';
        note = 'Claude Code needs attention on this PC (signed out, or out of usage). Trying again in 30 minutes.';
        pausedUntil = Date.now() + ATTENTION_PAUSE_MS;
      } else {
        mode = 'idle';
        note = null;
      }
      await db.heartbeat(cfg.owner, mode, note);
    } catch (error) {
      log('Loop error:', error instanceof Error ? error.message : error);
      await sleep(cfg.pollMs * 2);
    }
  }
  clearInterval(beat);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
