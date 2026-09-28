import { EXPORT_TABLES, STORAGE_BUCKETS, exportFilename } from '@/lib/account/deletion-plan';
import { listUserObjects } from '@/lib/account/storage';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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

// GET /api/account/export → a JSON download of the signed-in person's data.
export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub;
  if (claimsError || typeof userId !== 'string') {
    return Response.json({ message: 'Sign in again to export your data.' }, { status: 401, headers: NO_STORE });
  }
  if (!(await isAppUnlocked(claims))) {
    return Response.json({ message: 'Unlock Orbis on this device first, then export your data.' }, { status: 403, headers: NO_STORE });
  }

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
    account: { id: userId, email: typeof claims?.email === 'string' ? claims.email : null },
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
