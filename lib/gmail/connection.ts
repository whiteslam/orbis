import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { decryptRefreshToken } from '@/lib/gmail/crypto';
import { GoogleOAuthError, refreshGoogleAccessToken, revokeGoogleToken } from '@/lib/gmail/oauth';

export type GmailConnection = {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token_encrypted: string;
  status: 'connected' | 'reconnect_required';
};

/** The user's Google connection, or null when Gmail is not connected. */
export async function loadGmailConnection(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('gmail_connections')
    .select('id, user_id, google_email, refresh_token_encrypted, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error('Gmail data is not ready. Apply the database migrations and try again.');
  return (data as GmailConnection | null) ?? null;
}

async function markReconnectRequired(userId: string, connectionId: string) {
  const admin = createAdminClient();
  await admin
    .from('gmail_connections')
    .update({ status: 'reconnect_required', updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('user_id', userId);
}

/** A short-lived access token; a refused refresh token marks the connection for reconnecting. */
export async function gmailAccessToken(userId: string, connection: GmailConnection) {
  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(connection.refresh_token_encrypted);
  } catch (error) {
    console.error('Decrypting the Gmail refresh token failed', error);
    await markReconnectRequired(userId, connection.id);
    throw new GoogleOAuthError('Gmail needs to be reconnected.', true);
  }

  try {
    const token = await refreshGoogleAccessToken(refreshToken);
    return token.access_token;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.reconnectRequired) {
      await markReconnectRequired(userId, connection.id);
      throw error;
    }
    throw new GoogleOAuthError('Gmail could not be reached. Please try again.');
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
