import { EXPORT_TABLES, STORAGE_BUCKETS, exportFilename, refusalMessage, refusalStatus } from '@/lib/account/deletion-plan';
import { sensitiveRequester } from '@/lib/account/sensitive-auth';
import { listUserObjects } from '@/lib/account/storage';
import { decryptForUser, phoneDataReady } from '@/lib/crypto/user-keys';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPersonSettings } from '@/lib/locale/repository';
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
  'career-documents': 'Your master resume and the tailored resumes made for each application. Open an application in Career to download its files; your resume is in Career → Setup.',
  'research-memory': 'The Research desk’s memory log: its past calls and what it learned when each was scored. It isn’t opened in Orbis; the same calls and their scores are in this export’s research_runs and research_settlements tables.',
  shorts: 'Your faceless shorts: the finished videos, their covers and QA contact sheets. Open a short in Social → Shorts to download it.',
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Every row this person can read in one table, paged by its primary key (or each column of a composite one). */
async function readTable(supabase: Supabase, userId: string, table: string, columns: string, key: string | readonly string[]) {
  const rows: unknown[] = [];
  const order = typeof key === 'string' ? [key] : key;
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).eq('user_id', userId);
    for (const column of order) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Opens each signal's content for the person. Without the server key, or for a
 * row that can't be opened, the stored ciphertext is exported as it is, and the
 * returned note says so. Nothing about a signal is logged.
 */
function openSignals(rows: unknown[], userId: string): { rows: unknown[]; note: string | null } {
  if (!phoneDataReady()) {
    return { rows, note: 'Phone signal content is exported as stored (encrypted) because the server’s phone data key is not set up right now.' };
  }
  let unopened = 0;
  const opened = rows.map((row) => {
    const signal = row as { id?: unknown; content?: unknown };
    if (typeof signal.id !== 'string' || typeof signal.content !== 'string') return row;
    try {
      return { ...signal, content: decryptForUser(userId, signal.content, signal.id) };
    } catch {
      unopened += 1;
      return row;
    }
  });
  return { rows: opened, note: unopened ? `${unopened} phone signal(s) could not be unlocked and are exported as stored (encrypted).` : null };
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
    return Response.json({ reason: who.reason, message: who.message ?? refusalMessage(who.reason, 'export your data') }, { status: refusalStatus(who.reason), headers: NO_STORE });
  }
  const { supabase, userId, email } = who;

  const tables: Record<string, unknown[]> = {};
  const unavailable: string[] = [];
  const results = await Promise.all(EXPORT_TABLES.map(async ({ table, columns, key }) => {
    try {
      return { table, rows: await readTable(supabase, userId, table, columns, key) };
    } catch (error) {
      // A table this session can't read (or that isn't set up yet) is left out
      // and named, rather than failing the whole export.
      console.error(`Account export: ${table} could not be read`, error);
      return { table, rows: null };
    }
  }));
  for (const { table, rows } of results) {
    if (rows) tables[table] = rows;
    else unavailable.push(table);
  }
  let phoneDataNote: string | null = null;
  if (tables.signals) {
    const opened = openSignals(tables.signals, userId);
    tables.signals = opened.rows;
    phoneDataNote = opened.note;
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
  const { timeZone } = await getPersonSettings(userId);
  const body = {
    exportedAt: now.toISOString(),
    account: { id: userId, email: email || null },
    about: 'Everything Orbis holds for your account, as JSON. Stored files are listed by name but not included; each list says where in Orbis to download them. Passwords, app keys and connection tokens are never exported.',
    tables,
    ...(phoneDataNote ? { phoneDataNote } : {}),
    ...(unavailable.length ? { notIncluded: { tables: unavailable, reason: 'These could not be read just now. Export again later to include them.' } } : {}),
    files: files ?? { error: 'Your stored files could not be listed just now. Export again later to include the list.' },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      ...NO_STORE,
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(timeZone, now)}"`,
    },
  });
}
