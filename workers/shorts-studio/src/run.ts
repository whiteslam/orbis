// One claimed job, start to finish: the plan stage or the build stage. Claude
// Code does the creative work inside the project folder; this file decides
// what it may do, turns its stream into progress, checks what it left behind
// and is the only thing that uploads.

import { existsSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePlan, type ShortPlan } from '../../../lib/shorts/plan.ts';
import type { Delivery } from '../../../lib/shorts/types.ts';
import type { ClaudeOutcome, ClaudeRun } from './claude.ts';
import type { Config } from './config.ts';
import type { JobRow, WorkerDb } from './db.ts';
import { checkProbe, readDelivery } from './outputs.ts';
import { allowedTools, buildPrompt, planPrompt, SYSTEM_APPEND, type Paths } from './prompts.ts';
import { applyPlanToScript } from './script.ts';
import { needsAttention, resultOf, stepsFromStreamLine } from './stream.ts';

export type RunOutcome = 'plan_ready' | 'done' | 'failed' | 'cancelled' | 'attention';

export type RunDeps = {
  db: WorkerDb;
  cfg: Config;
  claude: (run: ClaudeRun) => Promise<ClaudeOutcome>;
  /** Extra arguments before Claude's own (tests run a fake through node). */
  claudePrefix?: string[];
  /** Runs a program, resolving with its exit code and output. */
  exec: (bin: string, args: string[], cwd: string) => Promise<{ code: number | null; output: string }>;
  is3d: (style: string) => boolean;
  /** How often to check the job wasn't cancelled. */
  checkEveryMs?: number;
};

export const PLAN_TIMEOUT_MS = 15 * 60_000;
export const BUILD_TIMEOUT_MS = 120 * 60_000;
export const ATTENTION = 'Claude Code needs attention on your PC (signed out, or out of usage). The worker will try again in 30 minutes.';

export const projectName = (job: Pick<JobRow, 'style' | 'id'>) => `${job.style}-${job.id.slice(0, 8)}`;

class Stop extends Error {
  readonly outcome: RunOutcome;
  constructor(outcome: RunOutcome, message: string) {
    super(message);
    this.outcome = outcome;
  }
}

const lastWords = (tail: string) => tail.replace(/\s+/g, ' ').trim().slice(-300);

export async function runJob(job: JobRow, deps: RunDeps): Promise<RunOutcome> {
  const { db, cfg } = deps;
  const paths: Paths = { skill: cfg.skillDir, project: join(cfg.projectsDir, projectName(job)) };
  const controller = new AbortController();
  let events = Promise.resolve();
  const emit = (kind: 'status' | 'step' | 'log' | 'qa', content: string) => {
    events = events.then(() => db.event(job, kind, content)).catch((error: unknown) => console.error('event', error));
    return events;
  };
  const watcher = setInterval(() => {
    void db.stillRunning(job).then((running) => { if (!running) controller.abort(); });
  }, deps.checkEveryMs ?? 20_000);

  async function claude(prompt: string, stage: 'plan' | 'build', timeoutMs: number) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (stage === 'build' && cfg.softwareGl && deps.is3d(job.style)) Object.assign(env, { SOFTWARE_GL: '1', QS: '&res=0.6&aa=0&shadow=1024', FPS: '24' });
    let reportedError = '';
    const outcome = await deps.claude({
      bin: cfg.claudeBin,
      argsPrefix: deps.claudePrefix,
      cwd: paths.project,
      prompt,
      system: SYSTEM_APPEND,
      tools: allowedTools(stage, paths),
      addDirs: [cfg.skillDir],
      timeoutMs,
      env,
      signal: controller.signal,
      onLine: (line) => {
        for (const step of stepsFromStreamLine(line)) void emit(step.kind, step.content);
        const result = resultOf(line);
        if (result?.isError) reportedError = result.text;
      },
    });
    await events;
    if (outcome.aborted) throw new Stop('cancelled', 'Cancelled.');
    if (needsAttention(`${outcome.tail}\n${reportedError}`)) throw new Stop('attention', ATTENTION);
    if (outcome.timedOut) throw new Stop('failed', `Claude Code ran past ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`);
    if (outcome.code !== 0 || reportedError) throw new Stop('failed', `Claude Code stopped with an error: ${lastWords(reportedError || outcome.tail) || `exit ${outcome.code}`}`);
  }

  async function readPlan(): Promise<{ ok: true; plan: ShortPlan } | { ok: false; errors: string[] }> {
    try {
      return validatePlan(JSON.parse(await readFile(join(paths.project, 'plan.json'), 'utf8')));
    } catch {
      return { ok: false, errors: ['plan.json is missing or isn’t valid JSON.'] };
    }
  }

  async function planStage(): Promise<RunOutcome> {
    if (!existsSync(paths.project)) {
      await emit('step', 'Setting up the project');
      const made = await deps.exec('bash', [join(cfg.skillDir, 'scripts', 'new_video.sh'), job.style, projectName(job), '--dir', cfg.projectsDir], cfg.skillDir);
      if (made.code !== 0) throw new Stop('failed', `The project couldn’t be set up: ${lastWords(made.output)}`);
    }
    const planFile = join(paths.project, 'plan.json');
    if (existsSync(planFile)) await rename(planFile, join(paths.project, 'plan.previous.json'));

    await emit('step', job.plan_feedback ? 'Revising the plan' : 'Writing the script and checking facts');
    await claude(planPrompt({ style: job.style, topic: job.topic, options: job.options, feedback: job.plan_feedback }, paths), 'plan', PLAN_TIMEOUT_MS);

    let checked = await readPlan();
    if (!checked.ok) {
      await emit('step', 'Fixing the plan');
      const repair = `plan.json in this folder failed these checks:\n${checked.errors.map((error) => `- ${error}`).join('\n')}\nFix plan.json (and script.json to match). Every caps chunk has 1-3 words and exactly one *yellow word; 3-30 lines. Change nothing else, then stop.`;
      await claude(repair, 'plan', PLAN_TIMEOUT_MS);
      checked = await readPlan();
    }
    if (!checked.ok) throw new Stop('failed', `The plan didn’t pass its checks: ${checked.errors.slice(0, 3).join(' ')}`);
    if (!(await db.finishPlan(job, checked.plan))) return 'cancelled';
    await emit('status', 'Plan ready for you');
    return 'plan_ready';
  }

  async function buildStage(): Promise<RunOutcome> {
    const approved = validatePlan(job.plan);
    if (!approved.ok) throw new Stop('failed', 'The approved plan is missing. Ask for a new plan.');
    if (!existsSync(join(paths.project, 'script.json'))) throw new Stop('failed', `The project folder is gone from your PC (${paths.project}). Ask for a new plan.`);

    const scriptFile = join(paths.project, 'script.json');
    await writeFile(scriptFile, applyPlanToScript(await readFile(scriptFile, 'utf8'), approved.plan, job.options));
    await writeFile(join(paths.project, 'plan.json'), `${JSON.stringify(approved.plan, null, 2)}\n`);
    for (const stale of ['delivery.json', 'renders/short.mp4', 'renders/share.mp4', 'renders/cover.jpg']) await rm(join(paths.project, stale), { force: true });

    await emit('step', 'Building from your approved plan');
    await claude(buildPrompt({ style: job.style, options: job.options }, paths), 'build', BUILD_TIMEOUT_MS);

    let deliveryText = '';
    try { deliveryText = await readFile(join(paths.project, 'delivery.json'), 'utf8'); } catch { /* checked below */ }
    const delivery = readDelivery(deliveryText);
    if (!delivery) throw new Stop('failed', 'The build finished without a usable delivery.json.');
    const video = join(paths.project, 'renders', 'short.mp4');
    if (!existsSync(video)) throw new Stop('failed', 'The build finished without renders/short.mp4.');
    const probe = await deps.exec('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', video], paths.project);
    const checked = checkProbe(probe.output);
    if (!checked.ok) throw new Stop('failed', checked.reason);

    await emit('step', 'Uploading to Orbis');
    const base = `${job.user_id}/${job.id}`;
    const put = async (local: string, name: string, type: string) => {
      const file = join(paths.project, local);
      if (!existsSync(file) || (await stat(file)).size === 0) return null;
      await db.upload(`${base}/${name}`, await readFile(file), type);
      return `${base}/${name}`;
    };
    const files = {
      video: (await put('renders/short.mp4', 'short.mp4', 'video/mp4')) as string,
      share: await put('renders/share.mp4', 'share.mp4', 'video/mp4'),
      cover: await put('renders/cover.jpg', 'cover.jpg', 'image/jpeg'),
      sheet: await put('review/all.jpg', 'sheet.jpg', 'image/jpeg'),
    };
    const done: Delivery = { ...delivery, seconds: checked.seconds, files };
    if (!(await db.finishBuild(job, done))) return 'cancelled';
    await emit('status', 'Your short is ready');
    return 'done';
  }

  try {
    return job.stage === 'build' ? await buildStage() : await planStage();
  } catch (error) {
    const stop = error instanceof Stop ? error : new Stop('failed', error instanceof Error ? error.message : 'Something went wrong on the worker.');
    if (stop.outcome !== 'cancelled') {
      await emit('status', stop.message);
      await db.fail(job, stop.message);
    }
    return stop.outcome;
  } finally {
    clearInterval(watcher);
    await events;
  }
}
