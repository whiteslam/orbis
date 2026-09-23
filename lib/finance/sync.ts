import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { decryptRefreshToken } from '@/lib/gmail/crypto';
import {
  buildIncrementalTransactionQuery,
  buildInitialTransactionQuery,
  getMessageMetadata,
  getMessagePlainText,
  isTransactionAlert,
  listTransactionMessages,
  GmailPageTokenExpiredError,
  GMAIL_PAGE_CAP,
} from '@/lib/gmail/api';
import {
  GoogleOAuthError,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from '@/lib/gmail/oauth';
import { parseTransactionAlert } from '@/lib/finance/parse-alert';

type GmailConnection = {
  id: string;
  user_id: string;
  google_email: string;
  google_user_id: string;
  refresh_token_encrypted: string;
  status: 'connected' | 'reconnect_required';
  last_sync_at: string | null;
  incremental_sync_after: string | null;
  incremental_sync_page_token: string | null;
  initial_sync_page_token: string | null;
  initial_sync_started_at: string | null;
};

type CandidateMessage = {
  connection_id: string;
  user_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  received_at: string;
  sync_state: 'pending';
};

const connectionColumns = 'id, user_id, google_email, google_user_id, refresh_token_encrypted, status, last_sync_at, incremental_sync_after, incremental_sync_page_token, initial_sync_page_token, initial_sync_started_at';
const METADATA_CONCURRENCY = 5;

async function loadConnection(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('gmail_connections')
    .select(connectionColumns)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error('Gmail data is not ready. Apply the finance database migration and try again.');
  if (!data) throw new GoogleOAuthError('Connect Gmail before syncing.');
  return data as GmailConnection;
}

async function updateConnection(userId: string, connectionId: string, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from('gmail_connections')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('user_id', userId);

  if (error) throw new Error('Gmail sync state could not be saved. Please try again.');
}

async function refreshAccessToken(userId: string, connection: GmailConnection) {
  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(connection.refresh_token_encrypted);
  } catch {
    await updateConnection(userId, connection.id, { status: 'reconnect_required' });
    throw new GoogleOAuthError('Gmail credentials could not be unlocked. Check the encryption key, then reconnect Gmail.', true);
  }

  try {
    const token = await refreshGoogleAccessToken(refreshToken);
    return token.access_token;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.reconnectRequired) {
      await updateConnection(userId, connection.id, { status: 'reconnect_required' });
      throw error;
    }
    throw new GoogleOAuthError('Gmail could not be reached. Please try again.');
  }
}

async function collectCandidateMetadata(accessToken: string, ids: Array<{ id: string; threadId: string }>) {
  const candidates: Array<{ id: string; threadId: string; receivedAt: string }> = [];

  for (let offset = 0; offset < ids.length; offset += METADATA_CONCURRENCY) {
    const batch = ids.slice(offset, offset + METADATA_CONCURRENCY);
    const results = await Promise.all(batch.map(({ id }) => getMessageMetadata(accessToken, id)));
    for (const message of results) {
      if (!message || !isTransactionAlert(message.subject)) continue;
      candidates.push({ id: message.id, threadId: message.threadId, receivedAt: message.receivedAt });
    }
  }

  return candidates;
}

async function saveCandidates(userId: string, connectionId: string, candidates: Array<{ id: string; threadId: string; receivedAt: string }>) {
  if (candidates.length === 0) return 0;

  const admin = createAdminClient();
  const rows: CandidateMessage[] = candidates.map((candidate) => ({
    connection_id: connectionId,
    user_id: userId,
    gmail_message_id: candidate.id,
    gmail_thread_id: candidate.threadId,
    received_at: candidate.receivedAt,
    sync_state: 'pending',
  }));

  const { data, error } = await admin
    .from('gmail_sync_messages')
    .upsert(rows, { onConflict: 'connection_id,gmail_message_id', ignoreDuplicates: true })
    .select('id');

  if (error) throw new Error('Transaction alert candidates could not be saved. Please try again.');
  return data?.length ?? 0;
}

async function performInitialSearch(userId: string, connection: GmailConnection, accessToken: string) {
  const startedAt = connection.initial_sync_started_at ?? new Date().toISOString();
  if (!connection.initial_sync_started_at) {
    await updateConnection(userId, connection.id, {
      initial_sync_started_at: startedAt,
      initial_sync_page_token: null,
    });
  }

  let pageToken = connection.initial_sync_page_token ?? undefined;
  let candidatesAdded = 0;
  const query = buildInitialTransactionQuery(startedAt);

  for (let pageNumber = 0; pageNumber < GMAIL_PAGE_CAP; pageNumber += 1) {
    const page = await listTransactionMessages(accessToken, query, pageToken);
    const metadata = await collectCandidateMetadata(accessToken, page.messageIds);
    candidatesAdded += await saveCandidates(userId, connection.id, metadata);

    if (!page.nextPageToken) {
      await updateConnection(userId, connection.id, {
        initial_sync_page_token: null,
        initial_sync_started_at: null,
        incremental_sync_after: null,
        incremental_sync_page_token: null,
        last_sync_at: new Date().toISOString(),
        status: 'connected',
      });
      return { candidatesAdded, syncComplete: true };
    }

    await updateConnection(userId, connection.id, {
      initial_sync_page_token: page.nextPageToken,
    });
    pageToken = page.nextPageToken;
  }

  return { candidatesAdded, syncComplete: false };
}

function incrementalAfterDate(lastSyncAt: string) {
  const date = new Date(lastSyncAt);
  date.setUTCDate(date.getUTCDate() - 3);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

async function performIncrementalSearch(userId: string, connection: GmailConnection, accessToken: string) {
  const afterDate = connection.incremental_sync_after ?? incrementalAfterDate(connection.last_sync_at ?? new Date().toISOString());
  if (!connection.incremental_sync_after) {
    await updateConnection(userId, connection.id, {
      incremental_sync_after: afterDate,
      incremental_sync_page_token: null,
    });
  }

  let pageToken = connection.incremental_sync_page_token ?? undefined;
  let candidatesAdded = 0;
  const query = buildIncrementalTransactionQuery(afterDate);

  for (let pageNumber = 0; pageNumber < GMAIL_PAGE_CAP; pageNumber += 1) {
    const page = await listTransactionMessages(accessToken, query, pageToken);
    const metadata = await collectCandidateMetadata(accessToken, page.messageIds);
    candidatesAdded += await saveCandidates(userId, connection.id, metadata);

    if (!page.nextPageToken) {
      await updateConnection(userId, connection.id, {
        incremental_sync_after: null,
        incremental_sync_page_token: null,
        last_sync_at: new Date().toISOString(),
        status: 'connected',
      });
      return { candidatesAdded, syncComplete: true };
    }

    await updateConnection(userId, connection.id, {
      incremental_sync_page_token: page.nextPageToken,
    });
    pageToken = page.nextPageToken;
  }

  return { candidatesAdded, syncComplete: false };
}

export async function syncGmail(userId: string) {
  const connection = await loadConnection(userId);
  const accessToken = await refreshAccessToken(userId, connection);
  const initialSync = !connection.last_sync_at || Boolean(connection.initial_sync_started_at);

  try {
    return initialSync
      ? await performInitialSearch(userId, connection, accessToken)
      : await performIncrementalSearch(userId, connection, accessToken);
  } catch (error) {
    if (error instanceof GmailPageTokenExpiredError) {
      await updateConnection(userId, connection.id, initialSync
        ? { initial_sync_page_token: null }
        : { incremental_sync_page_token: null });
      throw new GoogleOAuthError('The Gmail sync cursor expired. Tap Sync now to restart this search batch.');
    }
    if (error instanceof GoogleOAuthError && error.reconnectRequired) {
      await updateConnection(userId, connection.id, { status: 'reconnect_required' });
    }
    throw error;
  }
}

export async function disconnectGmail(userId: string) {
  const admin = createAdminClient();
  const { data: connection, error: readError } = await admin
    .from('gmail_connections')
    .select('id, refresh_token_encrypted')
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) throw new Error('Gmail could not be disconnected.');
  if (!connection) return { revoked: true };

  let revoked = false;
  try {
    const refreshToken = decryptRefreshToken(connection.refresh_token_encrypted);
    revoked = await revokeGoogleToken(refreshToken);
  } catch {
    // Local removal remains the priority if the token is already invalid or Google is unavailable.
  }

  const { error: deleteError } = await admin
    .from('gmail_connections')
    .delete()
    .eq('id', connection.id)
    .eq('user_id', userId);

  if (deleteError) throw new Error('Gmail could not be disconnected.');
  return { revoked };
}

export async function parsePendingFinanceCandidates(userId: string) {
  const connection = await loadConnection(userId);
  const accessToken = await refreshAccessToken(userId, connection);
  const admin = createAdminClient();
  const { data: candidates, error } = await admin
    .from('gmail_sync_messages')
    .select('id, gmail_message_id')
    .eq('user_id', userId)
    .eq('connection_id', connection.id)
    .eq('sync_state', 'pending')
    .eq('parse_status', 'unparsed')
    .order('received_at', { ascending: true })
    .limit(5);

  if (error) throw new Error('Finance review is not ready. Apply the transaction review migration and try again.');
  let parsedCount = 0;
  let unrecognizedCount = 0;

  for (const candidate of candidates ?? []) {
    const body = await getMessagePlainText(accessToken, candidate.gmail_message_id);
    const proposal = body
      ? parseTransactionAlert(body)
      : {
          parsedAmount: null,
          parsedCurrency: null,
          parsedDirection: null,
          parsedMerchant: null,
          parseStatus: 'unrecognized' as const,
          parseReason: 'The email body is unavailable, too large, or has no supported plain-text content. Enter details manually or ignore this alert.',
        };
    const { error: updateError } = await admin
      .from('gmail_sync_messages')
      .update({
        parsed_amount: proposal.parsedAmount,
        parsed_currency: proposal.parsedCurrency,
        parsed_direction: proposal.parsedDirection,
        parsed_merchant: proposal.parsedMerchant,
        parse_status: proposal.parseStatus,
        parse_reason: proposal.parseReason,
      })
      .eq('id', candidate.id)
      .eq('user_id', userId)
      .eq('connection_id', connection.id)
      .eq('sync_state', 'pending')
      .eq('parse_status', 'unparsed');

    if (updateError) throw new Error('Transaction details could not be prepared for review. Please try again.');
    if (proposal.parseStatus === 'needs_review') parsedCount += 1;
    else unrecognizedCount += 1;
  }

  return { parsedCount, unrecognizedCount, processedCount: candidates?.length ?? 0 };
}
