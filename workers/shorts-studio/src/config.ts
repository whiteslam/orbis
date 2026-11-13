// The worker's settings: ~/.config/orbis-shorts/.env (mode 600), overridden by
// the process environment. The service-role key lives only on this PC.

import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
  url: string;
  key: string;
  owner: string;
  skillDir: string;
  projectsDir: string;
  claudeBin: string;
  /** Render 3D styles in software (no GPU): slower, lower resolution. */
  softwareGl: boolean;
  pollMs: number;
};

export const DEFAULT_ENV_FILE = join(homedir(), '.config', 'orbis-shorts', '.env');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** KEY=value lines; # comments and surrounding quotes allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const expandHome = (path: string) => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path);

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env, readFile: (path: string) => string | null): Config {
  const fileValues = parseEnvFile(readFile(env.ORBIS_SHORTS_ENV ?? DEFAULT_ENV_FILE) ?? '');
  const get = (name: string) => (env[name] ?? fileValues[name] ?? '').trim();
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OWNER_USER_ID'].filter((name) => !get(name));
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Put them in ${env.ORBIS_SHORTS_ENV ?? DEFAULT_ENV_FILE} (see workers/shorts-studio/README.md).`);
  if (!UUID.test(get('OWNER_USER_ID'))) throw new Error('OWNER_USER_ID must be your Orbis user id (a UUID).');
  return {
    url: get('SUPABASE_URL'),
    key: get('SUPABASE_SERVICE_ROLE_KEY'),
    owner: get('OWNER_USER_ID').toLowerCase(),
    skillDir: expandHome(get('SKILL_DIR') || '~/.claude/skills/faceless-shorts'),
    projectsDir: expandHome(get('PROJECTS_DIR') || '~/faceless-shorts'),
    claudeBin: expandHome(get('CLAUDE_BIN') || 'claude'),
    softwareGl: get('SOFTWARE_GL') === '1',
    pollMs: Math.max(2000, Number(get('POLL_MS')) || 5000),
  };
}
