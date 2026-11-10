// One unattended Claude Code run: the prompt on stdin, stream-json on stdout,
// tools limited to an allowlist (anything else is refused, never asked), no
// MCP servers, nothing saved as a session. Ends on exit, timeout or abort.

import { spawn } from 'node:child_process';

export type ClaudeRun = {
  bin: string;
  /** Arguments before Claude's own (the tests run a fake through node). */
  argsPrefix?: string[];
  cwd: string;
  prompt: string;
  system: string;
  tools: string[];
  /** Folders Claude may read besides cwd (the skill). */
  addDirs: string[];
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
  signal: AbortSignal;
};

export type ClaudeOutcome = { code: number | null; timedOut: boolean; aborted: boolean; tail: string };

const TAIL = 4000;

export function claudeArgs(run: Pick<ClaudeRun, 'system' | 'tools' | 'addDirs'>): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'dontAsk',
    '--allowedTools', run.tools.join(','),
    '--append-system-prompt', run.system,
    ...run.addDirs.flatMap((dir) => ['--add-dir', dir]),
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
}

export function runClaude(run: ClaudeRun): Promise<ClaudeOutcome> {
  return new Promise((resolve) => {
    const child = spawn(run.bin, [...(run.argsPrefix ?? []), ...claudeArgs(run)], { cwd: run.cwd, env: run.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let tail = '';
    let pending = '';
    let timedOut = false;
    let aborted = false;
    const keep = (text: string) => { tail = (tail + text).slice(-TAIL); };

    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, run.timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    run.signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      keep(chunk);
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) run.onLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', keep);

    const finish = (code: number | null) => {
      clearTimeout(timer);
      run.signal.removeEventListener('abort', onAbort);
      if (pending.trim()) run.onLine(pending);
      resolve({ code, timedOut, aborted, tail });
    };
    child.on('error', (error) => { keep(`\n${error.message}`); finish(null); });
    child.on('close', finish);

    child.stdin.on('error', () => {});
    child.stdin.end(run.prompt);
  });
}
