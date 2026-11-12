import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Guard for the service-role ("admin") client. createAdminClient() skips
// row-level security, so every file that can open one has been reviewed and is
// listed in docs/security/service-role-uses.md. A new file importing it fails
// this test until someone reviews it, adds a row to that doc and adds the path
// below. Type-only imports don't count: they can't open a client.

const ADMIN_MODULE = 'lib/supabase/admin';
const DOC = 'docs/security/service-role-uses.md';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN_ROOTS = ['app', 'components', 'lib', 'workers'];

/** Repo-relative, forward-slash paths allowed to value-import `@/lib/supabase/admin`. Keep sorted. */
export const ADMIN_CLIENT_ALLOWLIST: readonly string[] = [
  'app/account/actions.ts',
  'app/api/account/export/route.ts',
  'app/api/career/ingest/route.ts',
  'app/api/career/watch/route.ts',
  'app/api/headsups/scan/route.ts',
  'app/api/notifications/dispatch/route.ts',
  'app/api/research/weekly/route.ts',
  'app/auth/callback/route.ts',
  'app/career/actions.ts',
  'app/headsups/actions.ts',
  'app/health/actions.ts',
  'app/health/library-actions.ts',
  'app/invest/ai-actions.ts',
  'app/personal/notification-actions.ts',
  'app/research/actions.ts',
  'app/social/actions.ts',
  'app/waitlist/actions.ts',
  'lib/account/delete.ts',
  'lib/ai/consent-store.ts',
  'lib/ai/jev.ts',
  'lib/ai/results.ts',
  'lib/ai/router.ts',
  'lib/ai/usage-store.ts',
  'lib/ask/answer.ts',
  'lib/career/ai.ts',
  'lib/career/drafting.ts',
  'lib/career/repository.ts',
  'lib/career/send.ts',
  'lib/career/watch.ts',
  'lib/gmail/connection.ts',
  'lib/gmail/oauth.ts',
  'lib/headsups/repository.ts',
  'lib/health-docs/repository.ts',
  'lib/home/brief-service.ts',
  'lib/invest/groww-connection.ts',
  'lib/invest/zerodha-connection.ts',
  'lib/marketing/waitlist.ts',
  'lib/news/portfolio.ts',
  'lib/providers/cache.ts',
  'lib/providers/status.ts',
  'lib/security/pin-store.ts',
  'lib/security/rate-limit.ts',
  'lib/social/connections.ts',
  'lib/storage/signed-upload.ts',
];

/** The repo-relative module a specifier points at, without extension, or null for a package. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) target = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return null;
  return path.posix.normalize(target).replace(/\.(ts|tsx|js|mjs)$/, '').replace(/\/index$/, '');
}

/**
 * Whether `source` (the file at repo-relative `file`) can reach the admin
 * client at run time: an import with at least one value binding, a bare
 * import, any re-export that isn't `export type`, `import x = require(…)`, or a
 * dynamic `import()` / `require()`. `import type …` and `import { type A }`
 * alone don't count.
 */
export function valueImportsAdmin(source: string, file: string): boolean {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isAdmin = (node: ts.Node | undefined) => !!node && ts.isStringLiteralLike(node) && resolveSpecifier(node.text, file) === ADMIN_MODULE;
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) && isAdmin(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause) { found = true; return; } // side-effect import
      if (clause.isTypeOnly) return;
      const named = clause.namedBindings;
      if (clause.name || (named && ts.isNamespaceImport(named))) { found = true; return; }
      if (named && ts.isNamedImports(named) && (named.elements.length === 0 || named.elements.some((element) => !element.isTypeOnly))) { found = true; return; }
      return;
    }
    if (ts.isExportDeclaration(node) && isAdmin(node.moduleSpecifier)) {
      if (node.isTypeOnly) return;
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)) return;
      found = true;
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) && isAdmin(node.moduleReference.expression)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && isAdmin(node.arguments[0])) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function sourceFiles(dir: string): string[] {
  const absolute = path.join(REPO_ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sourceFiles(relative);
    if (!/\.(ts|tsx|mts|cts)$/.test(entry.name) || /\.d\.ts$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [relative];
  });
}

test('only reviewed files open the service-role client', () => {
  const actual = SCAN_ROOTS.flatMap(sourceFiles)
    .filter((file) => valueImportsAdmin(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file))
    .sort();
  const allowed = new Set(ADMIN_CLIENT_ALLOWLIST);
  const found = new Set(actual);
  const added = actual.filter((file) => !allowed.has(file));
  const gone = ADMIN_CLIENT_ALLOWLIST.filter((file) => !found.has(file));
  const lines: string[] = [];
  if (added.length) {
    lines.push(`New service-role use, not reviewed yet:\n  ${added.join('\n  ')}`,
      `Use the person's own session (createClient() from @/lib/supabase/server) if row-level security allows it. If the service role is really needed, add a row to ${DOC} saying why and whose data it touches, then add the path to ADMIN_CLIENT_ALLOWLIST in lib/security/admin-usage.test.ts.`);
  }
  if (gone.length) {
    lines.push(`No longer imports the service-role client:\n  ${gone.join('\n  ')}`,
      `Remove these from ADMIN_CLIENT_ALLOWLIST in lib/security/admin-usage.test.ts and their rows from ${DOC}.`);
  }
  assert.deepEqual(actual, [...ADMIN_CLIENT_ALLOWLIST], lines.join('\n\n'));
});

test('the allowlist is sorted, unique, and every path exists', () => {
  assert.deepEqual([...ADMIN_CLIENT_ALLOWLIST], [...new Set(ADMIN_CLIENT_ALLOWLIST)].sort());
  for (const file of ADMIN_CLIENT_ALLOWLIST) assert.ok(existsSync(path.join(REPO_ROOT, file)), `${file} is listed but doesn't exist`);
});

test('every allowlisted file has a row in the review doc', () => {
  const doc = readFileSync(path.join(REPO_ROOT, DOC), 'utf8');
  const missing = ADMIN_CLIENT_ALLOWLIST.filter((file) => !doc.includes(`\`${file}\``));
  assert.deepEqual(missing, [], `Add a row to ${DOC} for each of these`);
});

test('value imports count; type-only imports do not', () => {
  const file = 'lib/example/thing.ts';
  const counts = (source: string) => valueImportsAdmin(source, file);
  assert.equal(counts("import { createAdminClient } from '@/lib/supabase/admin';"), true);
  assert.equal(counts("import {\n  createAdminClient,\n} from '@/lib/supabase/admin';"), true);
  assert.equal(counts("import * as admin from '@/lib/supabase/admin';"), true);
  assert.equal(counts("import '@/lib/supabase/admin';"), true);
  assert.equal(counts("import { type Foo, createAdminClient } from '@/lib/supabase/admin';"), true);
  assert.equal(counts("export { createAdminClient } from '@/lib/supabase/admin';"), true);
  assert.equal(counts("export * from '@/lib/supabase/admin';"), true);
  assert.equal(counts("const m = await import('@/lib/supabase/admin');"), true);
  assert.equal(counts("import { createAdminClient } from '../supabase/admin.ts';"), true);
  assert.equal(counts("import type { createAdminClient } from '@/lib/supabase/admin';"), false);
  assert.equal(counts("import {\n  type createAdminClient,\n} from '@/lib/supabase/admin';"), false);
  assert.equal(counts("export type { Foo } from '@/lib/supabase/admin';"), false);
  assert.equal(counts("type Admin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;"), false);
  assert.equal(counts("import { createClient } from '@/lib/supabase/server';"), false);
  assert.equal(counts("// import { createAdminClient } from '@/lib/supabase/admin';"), false);
});
