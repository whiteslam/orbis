import 'server-only';

import { openRouterModel } from '@/lib/ai/openrouter';
import { growwConfigured, growwOwnerEmail } from '@/lib/invest/groww';
import { CALENDAR_SCOPE, GMAIL_SCOPE } from '@/lib/gmail/oauth';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import type { ProviderId } from '@/lib/providers/core';
import { createAdminClient } from '@/lib/supabase/admin';

export type IntegrationState = 'connected' | 'idle' | 'not_configured' | 'attention' | 'degraded';

export type Integration = {
  id: string;
  label: string;
  purpose: string;
  state: IntegrationState;
  detail: string | null;
  lastSyncAt: string | null;
  usage: { used: number; limit: number } | null;
};

type StatusRow = { provider: string; last_success_at: string | null; last_error_at: string | null; last_error_kind: string | null };

const PROVIDERS: Array<{ id: ProviderId; label: string; purpose: string; key?: string; limit?: number }> = [
  { id: 'open_meteo', label: 'Weather', purpose: 'Open-Meteo · Home weather' },
  { id: 'frankfurter', label: 'Currency', purpose: 'Frankfurter · ECB exchange rates' },
  { id: 'alpha_vantage', label: 'Stock prices', purpose: 'Alpha Vantage · BSE and global quotes', key: 'ALPHA_VANTAGE_API_KEY', limit: 20 },
  { id: 'amfi', label: 'Fund & ETF prices', purpose: 'AMFI · daily NAVs' },
  { id: 'coingecko', label: 'Crypto prices', purpose: 'CoinGecko · INR prices', key: 'COINGECKO_API_KEY', limit: 300 },
];

function providerState(row: StatusRow | undefined): Pick<Integration, 'state' | 'detail' | 'lastSyncAt'> {
  if (!row) return { state: 'idle', detail: 'Ready, not used yet', lastSyncAt: null };
  const failing = row.last_error_at && (!row.last_success_at || row.last_error_at > row.last_success_at);
  if (failing) {
    if (row.last_error_kind === 'auth') return { state: 'attention', detail: 'API key was rejected', lastSyncAt: row.last_success_at };
    if (row.last_error_kind === 'rate_limited') return { state: 'degraded', detail: 'Daily limit reached, using saved data', lastSyncAt: row.last_success_at };
    return { state: 'degraded', detail: 'Temporarily unavailable, using saved data', lastSyncAt: row.last_success_at };
  }
  return { state: 'connected', detail: null, lastSyncAt: row.last_success_at };
}

export type AppConnections = {
  google: { email: string; status: string; gmail: boolean; calendar: boolean; lastSyncAt: string | null } | null;
  groww: { status: string; lastSyncAt: string | null; source: 'account' | 'server' } | null;
  growwSetupMessage: string | null;
};

// Account-level connections the user links themselves (Settings → App integrations).
export async function getAppConnections(userId: string, email: string | null): Promise<AppConnections> {
  const result: AppConnections = { google: null, groww: null, growwSetupMessage: null };
  try {
    const admin = createAdminClient();
    const [google, groww] = await Promise.all([
      admin.from('gmail_connections').select('*').eq('user_id', userId).maybeSingle(),
      admin.from('groww_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
    ]);
    if (google.data) {
      const scopes: string[] = Array.isArray(google.data.granted_scopes) ? google.data.granted_scopes : [];
      result.google = {
        email: google.data.google_email,
        status: google.data.status,
        // Connections made before scope tracking only ever had Gmail.
        gmail: !scopes.length || scopes.includes(GMAIL_SCOPE),
        calendar: scopes.includes(CALENDAR_SCOPE),
        lastSyncAt: google.data.last_sync_at,
      };
    }
    if (groww.data) result.groww = { status: groww.data.status, lastSyncAt: groww.data.last_sync_at, source: 'account' };
    else if (groww.error && ['PGRST205', 'PGRST204', '42P01'].includes(groww.error.code ?? '')) result.growwSetupMessage = 'Apply the Groww connections migration in Supabase to connect Groww.';
  } catch {
    // Show everything as not connected.
  }
  if (!result.groww && growwConfigured() && growwOwnerEmail() && email === growwOwnerEmail()) result.groww = { status: 'connected', lastSyncAt: null, source: 'server' };
  if (!result.growwSetupMessage && !credentialEncryptionReady()) result.growwSetupMessage = 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY).';
  return result;
}

export async function getIntegrationStatus(userId: string, email: string | null): Promise<Integration[]> {
  let statusRows: StatusRow[] = [];
  let usageRows: Array<{ provider: string; calls: number }> = [];
  let gmail: { status: string; last_sync_at: string | null } | null = null;
  let growwRow: { status: string; last_sync_at: string | null } | null = null;
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const [status, usage, connection, growwConnection] = await Promise.all([
      admin.from('api_provider_status').select('provider,last_success_at,last_error_at,last_error_kind'),
      admin.from('api_daily_usage').select('provider,calls').eq('usage_date', today),
      admin.from('gmail_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
      admin.from('groww_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
    ]);
    statusRows = (status.data ?? []) as StatusRow[];
    usageRows = (usage.data ?? []) as typeof usageRows;
    gmail = connection.data ?? null;
    growwRow = growwConnection.data ?? null;
  } catch {
    // Show configuration only.
  }

  const integrations: Integration[] = [];

  const owner = growwOwnerEmail();
  if (growwRow) {
    const ok = growwRow.status === 'connected';
    integrations.push({ id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: ok ? 'connected' : 'attention', detail: ok ? null : 'Reconnect in Invest', lastSyncAt: growwRow.last_sync_at, usage: null });
  } else if (growwConfigured() && owner && email === owner) {
    integrations.push({ id: 'groww', label: 'Groww', purpose: 'Holdings · read-only · server keys', state: 'connected', detail: null, lastSyncAt: null, usage: null });
  } else {
    integrations.push({ id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: 'not_configured', detail: 'Connect in Invest', lastSyncAt: null, usage: null });
  }

  integrations.push({
    id: 'gmail',
    label: 'Gmail',
    purpose: 'Bank and card alerts · read-only',
    state: !gmail ? 'not_configured' : gmail.status === 'connected' ? 'connected' : 'attention',
    detail: !gmail ? 'Connect in Finance' : gmail.status === 'connected' ? null : 'Reconnect in Finance',
    lastSyncAt: gmail?.last_sync_at ?? null,
    usage: null,
  });

  for (const provider of PROVIDERS) {
    const used = usageRows.find((row) => row.provider === provider.id)?.calls ?? 0;
    const usage = provider.limit ? { used, limit: provider.limit } : null;
    if (provider.key && !process.env[provider.key]?.trim()) {
      integrations.push({ id: provider.id, label: provider.label, purpose: provider.purpose, state: 'not_configured', detail: `Add ${provider.key}`, lastSyncAt: null, usage: null });
      continue;
    }
    integrations.push({ id: provider.id, label: provider.label, purpose: provider.purpose, usage, ...providerState(statusRows.find((row) => row.provider === provider.id)) });
  }

  const aiReady = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  integrations.push({
    id: 'ai',
    label: 'AI',
    purpose: `OpenRouter · ${openRouterModel()}`,
    state: aiReady ? 'connected' : 'not_configured',
    detail: aiReady ? null : 'Add OPENROUTER_API_KEY',
    lastSyncAt: null,
    usage: null,
  });

  return integrations;
}
