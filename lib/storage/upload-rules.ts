// What the browser may upload straight to Storage, shared by the browser (to
// check before asking) and the server (to check before signing). No server code.

/**
 * health-document and workbook stage in UPLOAD_BUCKET; career-resume goes to
 * CAREER_BUCKET, where the master resume is kept (see below).
 */
export type UploadKind = 'health-document' | 'workbook' | 'career-resume';

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
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export type UploadExtension = keyof typeof CONTENT_TYPES;

function extensionOf(name: unknown) {
  return typeof name === 'string' ? name.toLowerCase().split('.').pop() : undefined;
}

/** A staged upload's extension: a workbook or a PDF. */
export function uploadExtension(name: unknown): 'xlsx' | 'pdf' | null {
  const extension = extensionOf(name);
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

/**
 * The `{ path, name }` an action receives after a browser upload, or null when
 * the path isn't one this user's signing could have produced. Actions check this
 * before charging a rate-limit credit or claiming the path, so a forged path
 * costs nothing and touches nothing.
 */
export function stagedInput(userId: string, input: unknown): { path: string; name: string } | null {
  if (!input || typeof input !== 'object') return null;
  const { path, name } = input as { path?: unknown; name?: unknown };
  if (!isStagedPath(userId, path)) return null;
  return { path, name: typeof name === 'string' ? name : '' };
}

// ─── Career documents ──────────────────────────────────────────────────────
// The resume and tailored files live in their own private bucket, where each
// person may write under `${userId}/` with their own session (the bucket's
// storage policy), so a resume goes there straight from the browser.

export const CAREER_BUCKET = 'career-documents';
/** Matches the bucket's file_size_limit (202610270001_career.sql). */
export const MAX_CAREER_UPLOAD_BYTES = 10 * 1024 * 1024;

export type CareerUploadExtension = 'pdf' | 'docx';

export function careerUploadExtension(name: unknown): CareerUploadExtension | null {
  const extension = extensionOf(name);
  return extension === 'pdf' || extension === 'docx' ? extension : null;
}

const WRONG_CAREER_TYPE = 'Use a .pdf or .docx file. Older .doc files and images are not supported.';

/** A plain reason a resume can't be uploaded, or null when it can. */
export function careerUploadProblem(file: { name?: unknown; type?: unknown; size?: unknown } | null | undefined): string | null {
  if (!file || typeof file !== 'object') return 'Choose a PDF or Word (.docx) file.';
  if (!careerUploadExtension(file.name)) return WRONG_CAREER_TYPE;
  // As above: the name decides, and the stored content type is set from it.
  if (file.type !== undefined && typeof file.type !== 'string') return WRONG_CAREER_TYPE;
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return 'This file is empty. Choose your resume and try again.';
  if (file.size > MAX_CAREER_UPLOAD_BYTES) return 'This file is larger than 10 MB. Choose a smaller file and try again.';
  return null;
}

const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$/;

/** Where an uploaded resume goes: `${userId}/resume/${uuid}.${ext}`, picked by the server. */
export function careerResumePath(userId: string, uuid: string, extension: CareerUploadExtension) {
  return `${userId}/resume/${uuid}.${extension}`;
}

/** True only for a resume path the server could have picked for this user. */
export function isCareerResumePath(userId: string, path: unknown): path is string {
  const prefix = `${userId}/resume/`;
  return typeof path === 'string' && path.startsWith(prefix) && UUID_FILE.test(path.slice(prefix.length));
}

export function careerContentTypeFor(extension: CareerUploadExtension) {
  return CONTENT_TYPES[extension];
}
