import 'server-only';

import { GoogleOAuthError } from '@/lib/gmail/oauth';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_PAGE_SIZE = 25;
export const GMAIL_PAGE_CAP = 3;
const TRANSACTION_SUBJECT_TERMS = '{subject:transaction subject:purchase subject:payment subject:debited subject:credited subject:spent subject:refund subject:transfer subject:withdrawal subject:deposit}';

export type GmailMessageMetadata = {
  id: string;
  threadId: string;
  receivedAt: string;
  subject: string;
};

type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
};

export class GmailPageTokenExpiredError extends Error {
  constructor() {
    super('Gmail search page token expired.');
    this.name = 'GmailPageTokenExpiredError';
  }
}

async function gmailJson<T>(accessToken: string, url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (response.status === 401) throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
  if (response.status === 400 && url.searchParams.has('pageToken')) throw new GmailPageTokenExpiredError();
  if (!response.ok) throw new GoogleOAuthError('Gmail could not be synced. Please try again.');
  return (await response.json()) as T;
}

export function buildIncrementalTransactionQuery(afterDate: string) {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(afterDate)) throw new Error('Gmail sync date is invalid.');
  return `after:${afterDate} ${TRANSACTION_SUBJECT_TERMS}`;
}

export function buildInitialTransactionQuery(startedAt: string) {
  const cutoff = new Date(startedAt);
  if (Number.isNaN(cutoff.getTime())) throw new Error('Gmail sync start time is invalid.');
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  // Gmail date operators use day precision. Back up one day so timezone and boundary
  // differences cannot omit messages at the edge of this persisted import window.
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  const afterDate = `${cutoff.getUTCFullYear()}/${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}/${String(cutoff.getUTCDate()).padStart(2, '0')}`;
  return `after:${afterDate} ${TRANSACTION_SUBJECT_TERMS}`;
}

export async function listTransactionMessages(accessToken: string, query: string, pageToken?: string) {
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(GMAIL_PAGE_SIZE));
  url.searchParams.set('fields', 'messages(id,threadId),nextPageToken');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const data = await gmailJson<GmailListResponse>(accessToken, url);
  return {
    messageIds: (data.messages ?? []).flatMap((message) => message.id ? [{ id: message.id, threadId: message.threadId ?? '' }] : []),
    nextPageToken: data.nextPageToken,
  };
}

export async function getMessageMetadata(accessToken: string, messageId: string): Promise<GmailMessageMetadata | null> {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'metadata');
  url.searchParams.append('metadataHeaders', 'Subject');
  url.searchParams.set('fields', 'id,threadId,internalDate,payload(headers(name,value))');

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (response.status === 401) throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
  if (!response.ok) throw new GoogleOAuthError('Gmail could not be synced. Please try again.');

  const data = (await response.json()) as {
    id?: string;
    threadId?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  };
  if (!data.id || !data.threadId || !data.internalDate) return null;

  const headers = data.payload?.headers ?? [];
  const subject = headers.find((header) => header.name?.toLowerCase() === 'subject')?.value ?? '';
  const receivedAt = new Date(Number(data.internalDate)).toISOString();
  return { id: data.id, threadId: data.threadId, receivedAt, subject };
}

type GmailBodyPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailBodyPart[];
};

export async function getMessagePlainText(accessToken: string, messageId: string): Promise<string | null> {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'full');
  // The payload is streamed under a strict response-size cap below. Request its
  // full MIME tree so deeply nested multipart messages are not silently missed.
  url.searchParams.set('fields', 'sizeEstimate,payload');

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (response.status === 401) throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
  if (!response.ok) throw new GoogleOAuthError('A transaction alert could not be read. Please try again.');
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let responseBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseBytes += value.byteLength;
      if (responseBytes > 3 * 1024 * 1024) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  let message: { sizeEstimate?: number; payload?: GmailBodyPart };
  try {
    message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof message;
  } catch {
    return null;
  }
  if (!message.payload || typeof message.sizeEstimate !== 'number' || message.sizeEstimate > 2_000_000) return null;

  const encodedParts: string[] = [];
  function collectPlainText(part: GmailBodyPart, depth = 0) {
    if (depth > 10 || part.filename || part.body?.attachmentId) return;
    if (part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data) encodedParts.push(part.body.data);
    for (const child of part.parts ?? []) collectPlainText(child, depth + 1);
  }
  collectPlainText(message.payload);

  let byteCount = 0;
  const textParts: string[] = [];
  for (const encoded of encodedParts) {
    if (!/^[A-Za-z0-9_/-]+={0,2}$/.test(encoded) || encoded.length > 140_000) return null;
    const decoded = Buffer.from(encoded, 'base64url');
    byteCount += decoded.length;
    if (byteCount > 100 * 1024) return null;
    textParts.push(decoded.toString('utf8'));
  }

  const text = textParts.join('\n').replace(/\u0000/g, '').slice(0, 100_000).trim();
  return text || null;
}

const transactionSubjectPattern = /\b(transaction|purchase|payment|debited|credited|spent|refund|transfer|withdrawal|deposit)\b/i;

export function isTransactionAlert(subject: string) {
  return transactionSubjectPattern.test(subject);
}
