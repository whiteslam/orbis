import { test } from 'vitest';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs } from './claude.ts';
import { loadConfig, parseEnvFile } from './config.ts';

const OWNER = '1234abcd-0000-4000-8000-000000000001';

test('the env file parses with comments, export and quotes', () => {
  assert.deepEqual(parseEnvFile('# hi\nexport SUPABASE_URL="https://x.supabase.co"\nOWNER_USER_ID=abc\n\nbad line'), { SUPABASE_URL: 'https://x.supabase.co', OWNER_USER_ID: 'abc' });
});

test('the config takes the file, lets the environment win and expands ~', () => {
  const file = `SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=secret\nOWNER_USER_ID=${OWNER}\nCLAUDE_BIN=~/bin/claude`;
  const cfg = loadConfig({ SOFTWARE_GL: '1', SUPABASE_URL: 'https://y.supabase.co' }, () => file);
  assert.equal(cfg.url, 'https://y.supabase.co');
  assert.equal(cfg.claudeBin, join(homedir(), 'bin/claude'));
  assert.equal(cfg.skillDir, join(homedir(), '.claude/skills/faceless-shorts'));
  assert.equal(cfg.softwareGl, true);
  assert.equal(cfg.pollMs, 5000);
});

test('missing settings fail with a message that says where they go', () => {
  assert.throws(() => loadConfig({}, () => null), /Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_USER_ID/);
  assert.throws(() => loadConfig({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', OWNER_USER_ID: 'me' }, () => null), /must be your Orbis user id/);
});

test('Claude runs unattended with only the allowed tools and no MCP servers', () => {
  const args = claudeArgs({ system: 'sys', tools: ['Read', 'Bash(ls:*)'], addDirs: ['/skill'] });
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'dontAsk']);
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Bash(ls:*)');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2), ['--add-dir', '/skill']);
});
