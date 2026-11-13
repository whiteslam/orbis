import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');

// Parses KEY=value lines from an env file. Missing file gives {}. Never prints values.
export function readEnvFile(name: string): Record<string, string> {
  const file = path.join(ROOT, name);
  const env: Record<string, string> = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return env;
}

// The environment e2e runs with: .env.local, overridden by .env.test.local (the
// staging project, docs/ops/staging.md), overridden by the real environment.
export function e2eEnv(): Record<string, string> {
  return { ...readEnvFile('.env.local'), ...readEnvFile('.env.test.local'), ...process.env } as Record<string, string>;
}

const normalise = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

// Throws when the Supabase project e2e would create accounts in is production.
export function assertNotProduction(env: Record<string, string | undefined>) {
  const production = env.ORBIS_PRODUCTION_SUPABASE_URL;
  const target = env.NEXT_PUBLIC_SUPABASE_URL;
  if (production && target && normalise(production) === normalise(target)) {
    throw new Error('Refusing to run e2e against production Supabase. Point .env.test.local (or the environment) at the staging project — see docs/ops/staging.md.');
  }
}
