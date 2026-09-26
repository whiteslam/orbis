import 'server-only';

import { growwConfigured, growwOwnerEmail } from '@/lib/invest/groww';
import { envZerodhaCredentials } from '@/lib/invest/zerodha';
import type { BrokerId } from '@/lib/invest/brokers';
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

/** One linked broker, as Settings shows it. */
export type BrokerConnectionStatus = {
  id: BrokerId;
  status: 'connected' | 'reconnect_required';
  lastSyncAt: string | null;
  source: 'account' | 'server';
};

export type AppConnections = {
  google: { email: string; status: string; gmail: boolean; calendar: boolean; lastSyncAt: string | null } | null;
  /**
   * Keyed by broker, so Settings lists whatever the registry holds rather than
   * the one broker this file used to name. Adding a provider should not mean
   * editing this type.
   */
  brokers: Partial<Record<BrokerId, BrokerConnectionStatus>>;
  brokerSetupMessages: Partial<Record<BrokerId, string>>;
};

// Account-level connections the user links themselves (Settings → App integrations).
export async function getAppConnections(userId: string, email: string | null): Promise<AppConnections> {
  const result: AppConnections = { google: null, brokers: {}, brokerSetupMessages: {} };
  try {
    const admin = createAdminClient();
    const [google, groww, zerodha] = await Promise.all([
      admin.from('gmail_connections').select('*').eq('user_id', userId).maybeSingle(),
      admin.from('groww_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
      admin.from('zerodha_connections').select('status,last_sync_at,expires_at').eq('user_id', userId).maybeSingle(),
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
    const missingTable = (error: { code?: string } | null) => Boolean(error && ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? ''));

    if (groww.data) result.brokers.groww = { id: 'groww', status: groww.data.status, lastSyncAt: groww.data.last_sync_at, source: 'account' };
    else if (missingTable(groww.error)) result.brokerSetupMessages.groww = 'Apply the Groww connections migration in Supabase to connect Groww.';

    // A Zerodha session that has run out reads as needing a reconnect, not as
    // absent: Kite ends every session overnight, by design.
    if (zerodha.data) {
      const expired = zerodha.data.status === 'reconnect_required' || new Date(zerodha.data.expires_at).getTime() <= Date.now();
      result.brokers.zerodha = { id: 'zerodha', status: expired ? 'reconnect_required' : 'connected', lastSyncAt: zerodha.data.last_sync_at, source: 'account' };
    } else if (missingTable(zerodha.error)) {
      result.brokerSetupMessages.zerodha = 'Apply the Zerodha connections migration in Supabase to connect Zerodha.';
    }
  } catch {
    // Show everything as not connected.
  }
  if (!result.brokers.groww && growwConfigured() && growwOwnerEmail() && email === growwOwnerEmail()) {
    result.brokers.groww = { id: 'groww', status: 'connected', lastSyncAt: null, source: 'server' };
  }
  if (!envZerodhaCredentials()) result.brokerSetupMessages.zerodha = 'Zerodha is not configured on this server. Set ZERODHA_API_KEY and ZERODHA_API_SECRET.';
  if (!credentialEncryptionReady()) {
    const message = 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY).';
    result.brokerSetupMessages.groww ??= message;
    result.brokerSetupMessages.zerodha ??= message;
  }
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
      admin.from('zerodha_connections').select('status,last_sync_at,expires_at').eq('user_id', userId).maybeSingle(),
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

  // Anything built from your own data (the brief, plan, workbook advice,
  // portfolio suggestions) only goes to a provider the registry marks as one
  // that will not train on it. Today that is Groq. Without its key those
  // features stand down rather than sending the data somewhere that would keep it.
  const privateAi = Boolean(process.env.GROQ_API_KEY?.trim());
  const anyAi = privateAi || Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.MISTRAL_API_KEY?.trim());
  integrations.push({
    id: 'ai',
    label: 'AI',
    purpose: privateAi ? 'Routed to providers that don’t train on your data' : 'No provider that can hold your data',
    state: privateAi ? 'connected' : anyAi ? 'degraded' : 'not_configured',
    detail: privateAi ? null : anyAi ? 'Add GROQ_API_KEY: the others may train on what they receive' : 'Add GROQ_API_KEY',
    lastSyncAt: null,
    usage: null,
  });

  return integrations;
}
