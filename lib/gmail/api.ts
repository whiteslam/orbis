import 'server-only';

import { GoogleOAuthError } from '@/lib/gmail/oauth';

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
