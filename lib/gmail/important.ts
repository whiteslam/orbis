import 'server-only';

import { getMessageSummary, IMPORTANT_MAIL_QUERY, listMessageIds } from '@/lib/gmail/api';
import { gmailAccessToken, loadGmailConnection } from '@/lib/gmail/connection';
import { isAlertMail, senderName } from '@/lib/gmail/important-filter';
import type { ImportantMail, ImportantMailResult } from '@/lib/gmail/types';
import { GoogleOAuthError } from '@/lib/gmail/oauth';

// Read more than is shown: the alert filter usually drops a few.
const CANDIDATES = 25;
const SHOWN = 10;
const CONCURRENCY = 5;

/**
 * Important mail for Home, read live from Gmail on each request. Nothing is
 * stored: sender, subject and Gmail's snippet go straight to the browser.
 */
export async function getImportantMail(userId: string): Promise<ImportantMailResult> {
  const connection = await loadGmailConnection(userId);
  if (!connection) return { state: 'disconnected' };
  if (connection.status === 'reconnect_required') return { state: 'reconnect', email: connection.google_email };

  try {
    const accessToken = await gmailAccessToken(userId, connection);
    const ids = await listMessageIds(accessToken, IMPORTANT_MAIL_QUERY, CANDIDATES);
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
