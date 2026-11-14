// The worker end to end, with a fake `claude` (fake-claude.mjs) run through the
// real runner, real files in a temp folder and an in-memory database.

import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from './claude.ts';
import type { Config } from './config.ts';
import type { AutopilotDb } from './autopilot.ts';
import type { EventKind, JobRow, WorkerDb } from './db.ts';
import { projectName, runJob, type RunDeps } from './run.ts';
import type { ShortPlan } from '../../../lib/shorts/plan.ts';
import type { Delivery } from '../../../lib/shorts/types.ts';

const FAKE = fileURLToPath(new URL('../fake-claude.mjs', import.meta.url));
const PROBE = JSON.stringify({ streams: [{ codec_type: 'video', width: 1080, height: 1920 }], format: { duration: '31.5' } });

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'shorts-run-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.FAKE_MODE; });

type Memory = WorkerDb & { status: string; events: Array<{ kind: EventKind; content: string }>; uploads: string[]; plan: ShortPlan | null; delivery: Delivery | null; error: string | null };

function memoryDb(status: string): Memory {
  const memory = {
    status, events: [], uploads: [], plan: null, delivery: null, error: null,
    async nextJob() { return null; },
    async claim() { return true; },
    async event(_job: JobRow, kind: EventKind, content: string) { memory.events.push({ kind, content }); },
    async finishPlan(_job: JobRow, plan: ShortPlan) { if (memory.status !== 'planning') return false; memory.status = 'plan_ready'; memory.plan = plan; return true; },
    async finishBuild(_job: JobRow, delivery: Delivery) { if (memory.status !== 'building') return false; memory.status = 'done'; memory.delivery = delivery; return true; },
    async fail(_job: JobRow, message: string) { memory.status = 'failed'; memory.error = message; },
    async stillRunning() { return memory.status === 'planning' || memory.status === 'building'; },
    async upload(path: string) { memory.uploads.push(path); },
    async heartbeat() {},
    async syncStyles() {},
    async sweep() { return 0; },
  } as Memory;
  return memory;
}

function setup(stage: 'plan' | 'build', plan: unknown = null) {
  const skill = join(root, 'skill');
  const projects = join(root, 'projects');
  mkdirSync(join(skill, 'scripts'), { recursive: true });
  const job: JobRow = {
    id: '1234abcd-0000-4000-8000-000000000001', user_id: 'u1', style: 'inside-out', topic: 'gum', status: 'queued', stage,
    options: { seconds: 30, voice: 'am_michael', mode: 'voice', music: 'bed', endLine: '' }, plan, plan_feedback: null, attempt: 1,
  };
  const cfg: Config = { url: '', key: '', owner: 'u1', skillDir: skill, projectsDir: projects, claudeBin: process.execPath, softwareGl: false, pollMs: 5000 };
  const project = join(projects, projectName(job));
  const execCalls: string[][] = [];
  const deps = (db: WorkerDb): RunDeps => ({
    db, cfg, claude: runClaude, claudePrefix: [FAKE], is3d: () => false, checkEveryMs: 200,
    exec: async (bin, args) => {
      execCalls.push([bin, ...args]);
      if (bin === 'bash') { mkdirSync(project, { recursive: true }); writeFileSync(join(project, 'script.json'), JSON.stringify({ title: 'x', lines: [] })); }
      return { code: 0, output: bin === 'ffprobe' ? PROBE : '' };
    },
  });
  return { job, project, deps, execCalls };
}

const PLAN = { title: 'Fake Short', seconds: 30, sources: [], notes: '', lines: [1, 2, 3].map((n) => ({ text: `Line ${n}.`, caps: `LINE *${n}`, shot: `Shot ${n}` })) };

test('the plan stage sets up the project and leaves a valid plan for the owner', async () => {
  const { job, project, deps, execCalls } = setup('plan');
  const db = memoryDb('planning');
  assert.equal(await runJob(job, deps(db)), 'plan_ready');
  assert.equal(db.plan?.title, 'Fake Short');
  assert.equal(db.plan?.lines.length, 3);
  assert.equal(execCalls[0][0], 'bash');
  assert.match(execCalls[0][1], /new_video\.sh$/);
  assert.deepEqual(execCalls[0].slice(2), ['inside-out', projectName(job), '--dir', join(project, '..')]);
  assert.deepEqual(db.events.map((event) => event.content), ['Setting up the project', 'Writing the script and checking facts', 'Writing the script and the plan.', 'Plan ready for you']);
});

test('a plan that fails its checks after one repair fails the job', async () => {
  const { job, deps } = setup('plan');
  process.env.FAKE_MODE = 'bad-plan';
  const db = memoryDb('planning');
  assert.equal(await runJob(job, deps(db)), 'failed');
  assert.match(db.error ?? '', /didn’t pass its checks: Line 1, caption 1 has 4 words/);
  assert.ok(db.events.some((event) => event.content === 'Fixing the plan'));
});

test('the build writes the approved plan, checks the video and uploads the files', async () => {
  const { job, project, deps } = setup('build', PLAN);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'script.json'), JSON.stringify({ title: 'Old', lead: 0.4, lines: [] }));
  const db = memoryDb('building');
  assert.equal(await runJob(job, deps(db)), 'done');
  const script = JSON.parse(readFileSync(join(project, 'script.json'), 'utf8'));
  assert.equal(script.title, 'Fake Short');
  assert.equal(script.lines[2].caps, 'LINE *3');
  assert.deepEqual(db.uploads, [`u1/${job.id}/short.mp4`, `u1/${job.id}/cover.jpg`, `u1/${job.id}/sheet.jpg`]);
  assert.equal(db.delivery?.seconds, 31.5);
  assert.deepEqual(db.delivery?.hashtags, ['#fake', '#shorts']);
  const steps = db.events.filter((event) => event.kind === 'step').map((event) => event.content);
  assert.deepEqual(steps, ['Building from your approved plan', 'Recording the voice', 'Checking the shots', 'QA: checking every frame', 'Rendering the video', 'Uploading to Orbis']);
  assert.ok(db.events.some((event) => event.kind === 'qa'));
});

test('a cancelled job stops the run and is left as the owner set it', async () => {
  const { job, deps } = setup('plan');
  process.env.FAKE_MODE = 'slow';
  const db = memoryDb('planning');
  setTimeout(() => { db.status = 'cancelled'; }, 300);
  assert.equal(await runJob(job, deps(db)), 'cancelled');
  assert.equal(db.status, 'cancelled');
}, 15_000);

test('a signed-out Claude Code pauses the worker', async () => {
  const { job, deps } = setup('plan');
  process.env.FAKE_MODE = 'login';
  const db = memoryDb('planning');
  assert.equal(await runJob(job, deps(db)), 'attention');
  assert.match(db.error ?? '', /needs attention on your PC/);
});

function fakeAutopilot(approves = true, queue: 'queued' | 'already' | 'unavailable' | Error = 'queued') {
  const calls: string[] = [];
  const autopilot: AutopilotDb = {
    async startIfDue() { return null; },
    async approve() { calls.push('approve'); return approves; },
    async queueForYouTube() { calls.push('queue'); if (queue instanceof Error) throw queue; return queue; },
  };
  return { autopilot, calls };
}

test('an autopilot short approves its own plan; anyone else’s waits for the owner', async () => {
  const { job, deps } = setup('plan');
  const auto = { ...job, options: { ...job.options, autopilot: true } };
  const db = memoryDb('planning');
  const { autopilot, calls } = fakeAutopilot();
  assert.equal(await runJob(auto, { ...deps(db), autopilot }), 'plan_ready');
  assert.deepEqual(calls, ['approve']);
  assert.equal(db.events.at(-1)?.content, 'Plan approved by autopilot. Building next');

  const other = fakeAutopilot();
  const db2 = memoryDb('planning');
  assert.equal(await runJob(job, { ...deps(db2), autopilot: other.autopilot }), 'plan_ready');
  assert.deepEqual(other.calls, []);
  assert.equal(db2.events.at(-1)?.content, 'Plan ready for you');
});

test('a finished autopilot short goes to the YouTube queue, and a queue problem never fails the short', async () => {
  for (const [queue, said] of [['queued', 'Added to the YouTube queue'], [new Error('boom'), 'Couldn’t add it to the YouTube queue: boom. Add it from the short.']] as const) {
    const { job, project, deps } = setup('build', PLAN);
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'script.json'), JSON.stringify({ title: 'Old', lead: 0.4, lines: [] }));
    const auto = { ...job, options: { ...job.options, autopilot: true } };
    const db = memoryDb('building');
    const { autopilot, calls } = fakeAutopilot(true, queue);
    assert.equal(await runJob(auto, { ...deps(db), autopilot }), 'done');
    assert.deepEqual(calls, ['queue']);
    assert.equal(db.events.at(-1)?.content, said);
  }
});
