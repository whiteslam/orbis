import 'server-only';

import { ORBIS_REF_HEADER } from '@/lib/gmail/mime';
import { GoogleOAuthError } from '@/lib/gmail/oauth';
import { headerValue, messageBodies, type GmailPart } from '@/lib/gmail/parts';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Gmail's own judgement of what matters, kept to the Primary tab and the last
// two weeks. Alerts that still slip through are dropped in lib/gmail/important-filter.ts.
export const IMPORTANT_MAIL_QUERY = 'is:important category:primary newer_than:14d -in:chats -in:sent -in:drafts';

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  receivedAt: string;
  unread: boolean;
  snippet: string;
  from: string;
  subject: string;
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
};

type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
};

async function gmailJson<T>(accessToken: string, url: URL): Promise<T | null> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (response.status === 404) return null;
  if (response.status === 401) throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
  if (!response.ok) throw new GoogleOAuthError('Gmail could not be read. Please try again.');
  return (await response.json()) as T;
}

export async function listMessageIds(accessToken: string, query: string, maxResults: number) {
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('fields', 'messages(id,threadId)');

  const data = await gmailJson<GmailListResponse>(accessToken, url);
  return (data?.messages ?? []).flatMap((message) => message.id ? [message.id] : []);
}

// Gmail returns at most 500 ids a page.
const PAGE_MAX = 500;

/**
 * Up to `max` message ids for a search, newest first, following pages as
 * needed. listMessageIds stops at one page, which is right for Today's few
 * messages; the career watcher may need more.
 */
export async function listMessageIdsPaged(accessToken: string, query: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(max - ids.length, PAGE_MAX)));
    url.searchParams.set('fields', 'messages(id),nextPageToken');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await gmailJson<GmailListResponse>(accessToken, url); // NOSONAR: each page needs the previous page's token
    for (const message of data?.messages ?? []) if (message.id) ids.push(message.id);
    pageToken = data?.nextPageToken;
    if (!pageToken || !data?.messages?.length) break;
  }
  return ids.slice(0, max);
}

const SUMMARY_HEADERS = ['From', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted'];

/** Headers, labels and Gmail's short snippet. Never the message body. */
export async function getMessageSummary(accessToken: string, messageId: string): Promise<GmailMessageSummary | null> {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'metadata');
  for (const header of SUMMARY_HEADERS) url.searchParams.append('metadataHeaders', header);
  url.searchParams.set('fields', 'id,threadId,internalDate,labelIds,snippet,payload(headers(name,value))');

  const data = await gmailJson<{
    id?: string;
    threadId?: string;
    internalDate?: string;
    labelIds?: string[];
    snippet?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  }>(accessToken, url);
  if (!data?.id || !data.threadId || !data.internalDate) return null;

  const headers = data.payload?.headers ?? [];
  const header = (name: string) => headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value;
  return {
    id: data.id,
    threadId: data.threadId,
    receivedAt: new Date(Number(data.internalDate)).toISOString(),
    unread: data.labelIds?.includes('UNREAD') ?? false,
    snippet: data.snippet ?? '',
    from: header('From') ?? '',
    subject: header('Subject') ?? '',
    listUnsubscribe: header('List-Unsubscribe'),
    precedence: header('Precedence'),
    autoSubmitted: header('Auto-Submitted'),
  };
}

export type GmailMessageFull = {
  id: string;
  threadId: string;
  receivedAt: string;
  from: string;
  to: string;
  subject: string;
  /** The RFC 5322 Message-ID, `<…>`, for replying in the same thread. */
  messageIdHeader: string;
  references: string;
  /** The plain-text body, capped; '' when the message has only HTML. */
  text: string;
  /** The HTML body, capped, kept for its links; '' when there is none. */
  html: string;
};

/**
 * The whole message: headers and decoded bodies (lib/gmail/parts.ts). Only
 * for messages a feature has already decided to read; everything else stays
 * at getMessageSummary.
 */
export async function getMessageFull(accessToken: string, messageId: string): Promise<GmailMessageFull | null> {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'full');
  url.searchParams.set('fields', 'id,threadId,internalDate,payload');

  const data = await gmailJson<{ id?: string; threadId?: string; internalDate?: string; payload?: GmailPart }>(accessToken, url);
  if (!data?.id || !data.threadId || !data.internalDate) return null;

  const headers = data.payload?.headers;
  const { text, html } = messageBodies(data.payload);
  return {
    id: data.id,
    threadId: data.threadId,
    receivedAt: new Date(Number(data.internalDate)).toISOString(),
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject'),
    messageIdHeader: headerValue(headers, 'Message-ID'),
    references: headerValue(headers, 'References'),
    text,
    html,
  };
}

// ─── Sending ───────────────────────────────────────────────────────────────

/**
 * Gmail refused because the connection was never allowed to send (or the
 * owner took that back). The caller says "allow sending first"; it is not a
 * reason to reconnect.
 */
export class GmailSendScopeError extends Error {
  constructor() {
    super('Allow sending in Career → Setup first.');
    this.name = 'GmailSendScopeError';
  }
}

/**
 * The request went to Gmail but no answer came back (a timeout, a dropped
 * connection). Gmail may well have sent it: the caller must look in the Sent
 * folder (findSentByRef) before offering Send again.
 */
export class GmailSendUncertainError extends Error {
  constructor() {
    super('Gmail didn’t answer in time.');
    this.name = 'GmailSendUncertainError';
  }
}

/** True when a 403's body says the token lacks a scope, rather than some other refusal. */
function isScopeRefusal(body: string) {
  return /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(body);
}

/**
 * Sends one message (users.messages.send). `raw` is the base64url message from
 * lib/gmail/mime.ts; `threadId` keeps a reply in its thread, and the message
 * must also carry In-Reply-To and References for that. Only ever called from
 * an owner's press of Send.
 */
export async function sendMessage(accessToken: string, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error('Gmail send got no answer', error);
    throw new GmailSendUncertainError();
  }
  if (response.status === 401) throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
  if (response.status === 403 && isScopeRefusal(await response.text().catch(() => ''))) throw new GmailSendScopeError();
  if (!response.ok) {
    console.error('Gmail send failed', response.status);
    throw new GoogleOAuthError('Gmail could not send the message. Try again in a little while.');
  }
  // A 2xx means it went. An unreadable body must not look like a failure, or the
  // caller would offer Send again; empty ids say "sent, ids unknown".
  const data = (await response.json().catch(() => ({}))) as { id?: unknown; threadId?: unknown };
  return { id: typeof data.id === 'string' ? data.id : '', threadId: typeof data.threadId === 'string' ? data.threadId : '' };
}

/** Gmail search quoting: a phrase in double quotes, with any quote inside dropped. */
const quoted = (text: string) => `"${text.replaceAll('"', ' ').trim()}"`;

/**
 * The message in the Sent folder from the last day that carries this
 * X-Orbis-Ref, or null. Narrowed by recipient and subject, then each match's
 * header is checked, so another email with the same subject never counts.
 */
export async function findSentByRef(accessToken: string, input: { to: string; subject: string; ref: string }): Promise<{ id: string; threadId: string } | null> {
  const query = ['in:sent', 'newer_than:1d', `to:${quoted(input.to)}`, `subject:${quoted(input.subject.slice(0, 120))}`].join(' ');
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('fields', 'messages(id,threadId)');
  const list = await gmailJson<GmailListResponse>(accessToken, url);
  for (const message of list?.messages ?? []) {
    if (!message.id) continue;
    const one = new URL(`${GMAIL_API}/messages/${encodeURIComponent(message.id)}`);
    one.searchParams.set('format', 'metadata');
    one.searchParams.append('metadataHeaders', ORBIS_REF_HEADER);
    one.searchParams.set('fields', 'id,threadId,payload(headers(name,value))');
    const data = await gmailJson<{ id?: string; threadId?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }>(accessToken, one); // NOSONAR: at most ten, usually one
    const ref = data?.payload?.headers?.find((header) => header.name?.toLowerCase() === ORBIS_REF_HEADER.toLowerCase())?.value?.trim();
    if (data?.id && ref === input.ref) return { id: data.id, threadId: data.threadId ?? message.threadId ?? '' };
  }
  return null;
}
