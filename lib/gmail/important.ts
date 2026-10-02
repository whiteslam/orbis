import 'server-only';

import { getMessageSummary, IMPORTANT_MAIL_QUERY, listMessageIds } from '@/lib/gmail/api';
import { gmailAccessToken, loadGmailConnection } from '@/lib/gmail/connection';
import { isAlertMail, senderName } from '@/lib/gmail/important-filter';
import type { ImportantMail, ImportantMailResult } from '@/lib/gmail/types';
import { GoogleOAuthError } from '@/lib/gmail/oauth';
import { createClient } from '@/lib/supabase/server';

// Read more than is shown: the alert filter usually drops a few, and mail
// already acknowledged with "Got it" is left out before anything is fetched.
const CANDIDATES = 40;
const SHOWN = 10;
const CONCURRENCY = 5;

/**
 * Gmail ids the person has already said "Got it" to. A missing table (the
 * migration not applied yet) or a failed read hides nothing, rather than
 * hiding the whole list.
 */
async function acknowledgedIds(userId: string): Promise<Set<string>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('mail_acknowledgements').select('message_id').eq('user_id', userId).limit(1000);
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String(row.message_id)));
  } catch {
    return new Set();
  }
}

/**
 * Important mail for Home, read live from Gmail on each request. Nothing is
 * stored: sender, subject and Gmail's snippet go straight to the browser.
 */
export async function getImportantMail(userId: string): Promise<ImportantMailResult> {
  const connection = await loadGmailConnection(userId);
  if (!connection) return { state: 'disconnected' };
  if (connection.status === 'reconnect_required') return { state: 'reconnect', email: connection.google_email };

  try {
    const [accessToken, seen] = await Promise.all([gmailAccessToken(userId, connection), acknowledgedIds(userId)]);
    const ids = (await listMessageIds(accessToken, IMPORTANT_MAIL_QUERY, CANDIDATES)).filter((id) => !seen.has(id));
    const messages: ImportantMail[] = [];

    for (let offset = 0; offset < ids.length && messages.length < SHOWN; offset += CONCURRENCY) {
      const batch = await Promise.all(ids.slice(offset, offset + CONCURRENCY).map((id) => getMessageSummary(accessToken, id)));
      for (const message of batch) {
        if (!message || isAlertMail(message)) continue;
        messages.push({
          id: message.id,
          from: senderName(message.from).slice(0, 80),
          subject: (message.subject || '(no subject)').slice(0, 160),
          snippet: message.snippet.slice(0, 200),
          receivedAt: message.receivedAt,
          unread: message.unread,
          url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.google_email)}#all/${encodeURIComponent(message.threadId)}`,
        });
      }
    }

    return { state: 'ok', email: connection.google_email, messages: messages.slice(0, SHOWN) };
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.reconnectRequired) return { state: 'reconnect', email: connection.google_email };
    throw error;
  }
}
