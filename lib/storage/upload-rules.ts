// What the browser may upload straight to Storage, shared by the browser (to
// check before asking) and the server (to check before signing). No server code.

export type UploadKind = 'health-document' | 'workbook';

/**
 * Both kinds stage in one private bucket. health-documents keeps a 50 MB limit
 * for the originals it stores, but a document up to 100 MB may still be indexed
 * (only its text is kept then), so staging can't happen there.
 */
export const UPLOAD_BUCKET = 'workbook-uploads';
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export type UploadExtension = keyof typeof CONTENT_TYPES;

export function uploadExtension(name: unknown): UploadExtension | null {
  if (typeof name !== 'string') return null;
  const extension = name.toLowerCase().split('.').pop();
  return extension === 'xlsx' || extension === 'pdf' ? extension : null;
}

export function contentTypeFor(extension: UploadExtension) {
  return CONTENT_TYPES[extension];
}

const WRONG_TYPE = 'Use an .xlsx workbook or .pdf file. CSV and older .xls files are not supported.';

/** A plain reason the file can't be uploaded, or null when it can. */
export function uploadProblem(file: { name?: unknown; type?: unknown; size?: unknown } | null | undefined): string | null {
  if (!file || typeof file !== 'object') return 'Choose an Excel workbook or PDF file.';
  const extension = uploadExtension(file.name);
  if (!extension) return WRONG_TYPE;
  // The name decides, as the parser does: browsers leave the type blank or
  // mis-map it, and the server sets the stored content type itself anyway.
  if (file.type !== undefined && typeof file.type !== 'string') return WRONG_TYPE;
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return 'This file is empty. Choose a workbook or PDF with data.';
  if (file.size > MAX_UPLOAD_BYTES) return 'This file is larger than 100 MB. Choose a smaller file and try again.';
  return null;
}

/** A staged object's path is `${userId}/${uuid}.${ext}`; anything else is refused. */
export function isStagedPath(userId: string, path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith(`${userId}/`)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(xlsx|pdf)$/.test(path.slice(userId.length + 1));
}
