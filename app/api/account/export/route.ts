import { EXPORT_TABLES, STORAGE_BUCKETS, exportFilename, refusalMessage, refusalStatus } from '@/lib/account/deletion-plan';
import { sensitiveRequester } from '@/lib/account/sensitive-auth';
import { listUserObjects } from '@/lib/account/storage';
import { createAdminClient } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' } as const;
const PAGE = 1000;

// Where each kind of stored file can be downloaded in Orbis. The export lists
// the files; it doesn't carry them.
const FILE_HELP: Record<string, string> = {
  'health-documents': 'Your health documents. Open each one from Health, in your library, to download it.',
  'social-media': 'Photos and videos attached to your social posts. Open a post in Social to save its media.',
  'journal-voice': 'Voice notes attached to your journal. Play them from Journal to save them.',
  'workbook-uploads': 'Files uploaded for reading. These are temporary copies; the originals are on your device.',
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Every row this person can read in one table, paged by its primary key. */
async function readTable(supabase: Supabase, userId: string, table: string, key: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).order(key, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Reads `{ password? }` from a same-origin JSON request; anything else is refused. */
async function readPassword(request: Request): Promise<{ password: unknown } | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return null;
  try {
    const body = await request.json();
    return { password: body && typeof body === 'object' ? (body as { password?: unknown }).password : undefined };
  } catch {
    return null;
  }
}

// POST /api/account/export { password? } → a JSON download of the signed-in
// person's data. POST rather than GET so the password can travel in the body
// and a refusal comes back as a message the page shows, not a saved file. It
// needs the same proof as deleting the account: Orbis unlocked here, and a
// sign-in in the last ten minutes or the password.
export async function POST(request: Request) {
  const input = await readPassword(request);
  if (!input) return Response.json({ message: 'Your export couldn’t be started. Reload Orbis and try again.' }, { status: 400, headers: NO_STORE });
  const who = await sensitiveRequester(input.password);
  if (!who.ok) {
    return Response.json({ reason: who.reason, message: refusalMessage(who.reason, 'export your data') }, { status: refusalStatus(who.reason), headers: NO_STORE });
  }
  const { supabase, userId, email } = who;

  const tables: Record<string, unknown[]> = {};
  const unavailable: string[] = [];
  for (const { table, key } of EXPORT_TABLES) {
    try {
      tables[table] = await readTable(supabase, userId, table, key);
    } catch (error) {
      // A table this session can't read (or that isn't set up yet) is left out
      // and named, rather than failing the whole export.
      console.error(`Account export: ${table} could not be read`, error);
      unavailable.push(table);
    }
  }

  let files: Array<{ bucket: string; about: string; paths: string[] }> | null = null;
  try {
    // Several buckets are server-only, so the file list is read with the
    // service client, strictly under this person's own folder.
    const found = await listUserObjects(createAdminClient().storage, STORAGE_BUCKETS, userId);
    files = found.map(({ bucket, paths }) => ({ bucket, about: FILE_HELP[bucket] ?? '', paths }));
  } catch (error) {
    console.error('Account export: file list failed', error);
  }

  const now = new Date();
  const body = {
    exportedAt: now.toISOString(),
    account: { id: userId, email: email || null },
    about: 'Everything Orbis holds for your account, as JSON. Stored files are listed by name but not included; each list says where in Orbis to download them. Passwords, app keys and connection tokens are never exported.',
    tables,
    ...(unavailable.length ? { notIncluded: { tables: unavailable, reason: 'These could not be read just now. Export again later to include them.' } } : {}),
    files: files ?? { error: 'Your stored files could not be listed just now. Export again later to include the list.' },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      ...NO_STORE,
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(now)}"`,
    },
  });
}
