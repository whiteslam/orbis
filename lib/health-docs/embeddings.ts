import 'server-only';

// Text embeddings through OpenRouter (same key as chat). 1536 dimensions to
// match the health_document_chunks.embedding column.
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 64;

const embeddingModel = () => process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small';

export class EmbeddingError extends Error {}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new EmbeddingError('AI search is not configured. Add OPENROUTER_API_KEY to the server environment.');

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
