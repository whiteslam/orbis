import 'server-only';

// Text embeddings through OpenRouter. 1536 dimensions, to match the
// health_document_chunks.embedding column.
//
// KNOWN GAP: this is the last path that sends personal data straight to a
// provider instead of through lib/ai/router.ts, and what it sends is document
// text itself, chunk by chunk. It cannot be routed yet because ai_models only
// describes chat models (context_window, supports_json) and nothing in the
// registry marks a model as an embedding model or records its dimensions.
//
// Closing it means extending the registry with a kind and a dimensions column,
// seeding an embedding model on a provider whose may_train is false, and giving
// the router an embeddings path. Until then this respects the same rule the
// router enforces by refusing to run unless the key is explicitly opted in.
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 64;

const embeddingModel = () => process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small';

export class EmbeddingError extends Error {}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  // Opt-in by name: indexing a document sends its text to a provider the
  // registry marks as one that may train on it, so it must be a deliberate act
  // rather than a side effect of having a chat key configured.
  if (!apiKey || process.env.ORBIS_ALLOW_EXTERNAL_EMBEDDINGS?.trim() !== 'true') {
    throw new EmbeddingError('Document search is off. It would send your document text to a provider that may train on it, so set ORBIS_ALLOW_EXTERNAL_EMBEDDINGS=true to allow that.');
  }

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'Orbis Health Library' },
      body: JSON.stringify({ model: embeddingModel(), input: batch, dimensions: EMBEDDING_DIMENSIONS }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response?.ok) throw new EmbeddingError(response?.status === 402 ? 'The AI account is out of credit, so the document could not be indexed.' : 'The document could not be indexed for AI search right now. Try again shortly.');

    const body = await response.json().catch(() => null) as { data?: Array<{ index: number; embedding: number[] }> } | null;
    const rows = (body?.data ?? []).slice().sort((left, right) => left.index - right.index);
    if (rows.length !== batch.length || rows.some((row) => !Array.isArray(row.embedding) || row.embedding.length !== EMBEDDING_DIMENSIONS)) {
      throw new EmbeddingError('The AI returned an unexpected index for this document. Try again.');
    }
    vectors.push(...rows.map((row) => row.embedding));
  }
  return vectors;
}

// pgvector accepts the "[1,2,3]" text form.
export const toVectorLiteral = (vector: number[]) => `[${vector.join(',')}]`;
