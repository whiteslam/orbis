import 'server-only';

import { embedTexts, toVectorLiteral } from '@/lib/health-docs/embeddings';
import type { HealthDocument, HealthPlanRecord } from '@/lib/health-docs/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const HEALTH_BUCKET = 'health-documents';
export const MAX_STORED_ORIGINAL_BYTES = 50 * 1024 * 1024;
const MAX_CHUNKS = 400;
const CHUNK_CHARS = 1_200;

const isMissing = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

// Groups lines into ~1,200-character chunks, repeating the last line of each
// chunk at the start of the next so facts that span a boundary stay findable.
export function chunkLines(fileName: string, lines: string[]) {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!line) continue;
    if (length + line.length > CHUNK_CHARS && current.length) {
      chunks.push(`${fileName}\n${current.join('\n')}`);
      const carry = current[current.length - 1];
      current = [carry];
      length = carry.length;
    }
    current.push(line);
    length += line.length + 1;
    if (chunks.length >= MAX_CHUNKS) break;
  }
  if (current.length && chunks.length < MAX_CHUNKS) chunks.push(`${fileName}\n${current.join('\n')}`);
  return chunks.map((chunk) => chunk.slice(0, 4000));
}

export type LibraryState = { state: 'ready' | 'setup' | 'unavailable'; documents: HealthDocument[]; plans: HealthPlanRecord[] };

export async function getHealthLibrary(userId: string): Promise<LibraryState> {
  const supabase = await createClient();
  const [documents, plans] = await Promise.all([
    supabase.from('health_documents').select('id,file_name,kind,size_bytes,storage_path,chunk_count,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('health_plans').select('id,title,plan,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
  ]);
  const error = documents.error ?? plans.error;
  if (error) return { state: isMissing(error.code) ? 'setup' : 'unavailable', documents: [], plans: [] };
  return {
    state: 'ready',
    documents: (documents.data ?? []).map((row) => ({
      id: row.id,
      fileName: row.file_name,
      kind: row.kind,
      sizeBytes: Number(row.size_bytes),
      hasOriginal: Boolean(row.storage_path),
      chunkCount: row.chunk_count,
      createdAt: row.created_at,
    })),
    plans: (plans.data ?? []).map((row) => ({ id: row.id, title: row.title, plan: row.plan, createdAt: row.created_at })),
  };
}

// Saves the original (when small enough), indexes the text, and records the document.
export async function storeHealthDocument(userId: string, input: { file: File; fileName: string; kind: 'pdf' | 'xlsx'; preview: unknown; textLines: string[] }) {
  const admin = createAdminClient();
  const chunks = chunkLines(input.fileName, input.textLines);
  if (!chunks.length) throw new Error('No readable text was found to save from this file.');
  const vectors = await embedTexts(chunks);

  const { data: document, error } = await admin.from('health_documents').insert({
    user_id: userId,
    file_name: input.fileName,
    kind: input.kind,
    size_bytes: input.file.size,
    preview: input.preview,
    chunk_count: chunks.length,
  }).select('id').single();
  if (error || !document) throw new Error(isMissing(error?.code) ? 'Apply the health documents migration in Supabase first.' : 'The document could not be saved.');

  try {
    const rows = chunks.map((content, index) => ({ document_id: document.id, user_id: userId, chunk_index: index, content, embedding: toVectorLiteral(vectors[index]) }));
    for (let start = 0; start < rows.length; start += 100) {
      const { error: chunkError } = await admin.from('health_document_chunks').insert(rows.slice(start, start + 100));
      if (chunkError) throw new Error('The document text could not be indexed.');
    }

    let storedOriginal = false;
    if (input.file.size <= MAX_STORED_ORIGINAL_BYTES) {
      const path = `${userId}/${document.id}/${input.fileName}`;
      const { error: uploadError } = await admin.storage.from(HEALTH_BUCKET).upload(path, Buffer.from(await input.file.arrayBuffer()), {
        contentType: input.kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });
      if (!uploadError) {
        await admin.from('health_documents').update({ storage_path: path }).eq('id', document.id);
        storedOriginal = true;
      }
    }
    return { id: document.id, chunkCount: chunks.length, storedOriginal };
  } catch (caught) {
    await admin.from('health_documents').delete().eq('id', document.id);
    throw caught;
  }
}

export async function deleteHealthDocument(userId: string, documentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from('health_documents').select('storage_path').eq('id', documentId).eq('user_id', userId).maybeSingle();
  if (error || !data) throw new Error('This document was not found.');
  if (data.storage_path) await admin.storage.from(HEALTH_BUCKET).remove([data.storage_path]);
  const { error: deleteError } = await admin.from('health_documents').delete().eq('id', documentId).eq('user_id', userId);
  if (deleteError) throw new Error('The document could not be deleted.');
}

export async function signedDownloadUrl(userId: string, documentId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('health_documents').select('storage_path,file_name').eq('id', documentId).eq('user_id', userId).maybeSingle();
  if (!data?.storage_path) throw new Error('The original file isn’t stored for this document.');
  const { data: signed, error } = await admin.storage.from(HEALTH_BUCKET).createSignedUrl(data.storage_path, 60, { download: data.file_name });
  if (error || !signed) throw new Error('The download link could not be created.');
  return signed.signedUrl;
}

// Retrieval: the user's most relevant document passages for a question.
export async function searchHealthDocuments(userId: string, query: string, count = 8) {
  const admin = createAdminClient();
  const { count: total } = await admin.from('health_document_chunks').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (!total) return [];
  const [vector] = await embedTexts([query.slice(0, 2000)]);
  const { data, error } = await admin.rpc('match_health_chunks', { p_user_id: userId, p_embedding: toVectorLiteral(vector), p_count: count });
  if (error) return [];
  return (data ?? []) as Array<{ document_id: string; chunk_index: number; content: string; similarity: number }>;
}
