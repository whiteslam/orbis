import 'server-only';

import { growwConfigured, growwOwnerEmail } from '@/lib/invest/groww';
import { envZerodhaCredentials } from '@/lib/invest/zerodha';
import type { BrokerId } from '@/lib/invest/brokers';
import { CALENDAR_SCOPE, GMAIL_SCOPE } from '@/lib/gmail/oauth';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import type { ProviderId } from '@/lib/providers/core';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { CONNECTION_UNAVAILABLE } from '@/lib/errors';

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
];

function providerState(row: StatusRow | undefined): Pick<Integration, 'state' | 'detail' | 'lastSyncAt'> {
  if (!row) return { state: 'idle', detail: 'Ready, not used yet', lastSyncAt: null };
  const failing = row.last_error_at && (!row.last_success_at || row.last_error_at > row.last_success_at);
  if (failing) {
    if (row.last_error_kind === 'auth') return { state: 'attention', detail: 'Not available right now', lastSyncAt: row.last_success_at };
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

// Account-level connections the user links themselves (Settings → Connections).
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

    if (groww.data) result.brokers.groww = { id: 'groww', status: groww.data.status, lastSyncAt: groww.data.last_sync_at, source: 'account' };
    else if (isMissingTable(groww.error)) {
      console.error('groww_connections is missing', groww.error);
      result.brokerSetupMessages.groww = CONNECTION_UNAVAILABLE;
    }

    // A Zerodha session that has run out reads as needing a reconnect, not as
    // absent: Kite ends every session overnight, by design.
    if (zerodha.data) {
      const expired = zerodha.data.status === 'reconnect_required' || new Date(zerodha.data.expires_at).getTime() <= Date.now();
      result.brokers.zerodha = { id: 'zerodha', status: expired ? 'reconnect_required' : 'connected', lastSyncAt: zerodha.data.last_sync_at, source: 'account' };
    } else if (isMissingTable(zerodha.error)) {
      console.error('zerodha_connections is missing', zerodha.error);
      result.brokerSetupMessages.zerodha = CONNECTION_UNAVAILABLE;
    }
  } catch {
    // Show everything as not connected.
  }
  if (!result.brokers.groww && growwConfigured() && growwOwnerEmail() && email === growwOwnerEmail()) {
    result.brokers.groww = { id: 'groww', status: 'connected', lastSyncAt: null, source: 'server' };
  }
  if (!envZerodhaCredentials()) {
    console.error('Zerodha is not configured: ZERODHA_API_KEY and ZERODHA_API_SECRET are unset.');
    result.brokerSetupMessages.zerodha = CONNECTION_UNAVAILABLE;
  }
  if (!credentialEncryptionReady()) {
    console.error('Secure storage is not configured: set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY).');
    result.brokerSetupMessages.groww ??= CONNECTION_UNAVAILABLE;
    result.brokerSetupMessages.zerodha ??= CONNECTION_UNAVAILABLE;
  }
  return result;
}

type ConnectionRow = { status: string; last_sync_at: string | null };

type IntegrationRows = {
  statusRows: StatusRow[];
  usageRows: Array<{ provider: string; calls: number }>;
  gmail: ConnectionRow | null;
  growwRow: ConnectionRow | null;
};

/** Provider health, today's usage and this person's connections; empty when they cannot be read. */
async function readIntegrationRows(userId: string): Promise<IntegrationRows> {
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const [status, usage, connection, growwConnection] = await Promise.all([
      admin.from('api_provider_status').select('provider,last_success_at,last_error_at,last_error_kind'),
      admin.from('api_daily_usage').select('provider,calls').eq('usage_date', today),
      admin.from('gmail_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
      admin.from('groww_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
    ]);
    return {
      statusRows: (status.data ?? []) as StatusRow[],
      usageRows: (usage.data ?? []) as IntegrationRows['usageRows'],
      gmail: connection.data ?? null,
      growwRow: growwConnection.data ?? null,
    };
  } catch {
    // Show configuration only.
    return { statusRows: [], usageRows: [], gmail: null, growwRow: null };
  }
}

function growwIntegration(growwRow: ConnectionRow | null, email: string | null): Integration {
  const owner = growwOwnerEmail();
  if (growwRow) {
    const ok = growwRow.status === 'connected';
    return { id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: ok ? 'connected' : 'attention', detail: ok ? null : 'Reconnect in Settings → Connections', lastSyncAt: growwRow.last_sync_at, usage: null };
  }
  if (growwConfigured() && owner && email === owner) {
    return { id: 'groww', label: 'Groww', purpose: 'Holdings · read-only · server keys', state: 'connected', detail: null, lastSyncAt: null, usage: null };
  }
  return { id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: 'not_configured', detail: 'Connect in Money → Investments', lastSyncAt: null, usage: null };
}

function gmailIntegration(gmail: ConnectionRow | null): Integration {
  const base = { id: 'gmail', label: 'Gmail', purpose: 'Important mail on Today · read-only', usage: null };
  if (!gmail) return { ...base, state: 'not_configured', detail: 'Connect in Settings → Connections', lastSyncAt: null };
  const ok = gmail.status === 'connected';
  return { ...base, state: ok ? 'connected' : 'attention', detail: ok ? null : 'Reconnect in Settings → Connections', lastSyncAt: gmail.last_sync_at ?? null };
}

function providerIntegration(provider: (typeof PROVIDERS)[number], { statusRows, usageRows }: IntegrationRows): Integration {
  if (provider.key && !process.env[provider.key]?.trim()) {
    return { id: provider.id, label: provider.label, purpose: provider.purpose, state: 'not_configured', detail: 'Not available right now', lastSyncAt: null, usage: null };
  }
  const used = usageRows.find((row) => row.provider === provider.id)?.calls ?? 0;
  const usage = provider.limit ? { used, limit: provider.limit } : null;
  return { id: provider.id, label: provider.label, purpose: provider.purpose, usage, ...providerState(statusRows.find((row) => row.provider === provider.id)) };
}

/**
 * Anything built from your own data (the brief, plan, workbook advice,
 * portfolio suggestions) only goes to a provider the registry marks as one
 * that will not train on it. Today that is Groq. Without its key those
 * features stand down rather than sending the data somewhere that would keep it.
 */
function aiIntegration(): Integration {
  const base = { id: 'ai', label: 'AI', lastSyncAt: null, usage: null };
  if (process.env.GROQ_API_KEY?.trim()) {
    return { ...base, purpose: 'Routed to providers that don’t train on your data', state: 'connected', detail: null };
  }
  const anyAi = Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.MISTRAL_API_KEY?.trim());
  return { ...base, purpose: 'No provider that can hold your data', state: anyAi ? 'degraded' : 'not_configured', detail: 'Personal features stay off until a private provider is available' };
}

export async function getIntegrationStatus(userId: string, email: string | null): Promise<Integration[]> {
  const rows = await readIntegrationRows(userId);
  return [
    growwIntegration(rows.growwRow, email),
    gmailIntegration(rows.gmail),
    ...PROVIDERS.map((provider) => providerIntegration(provider, rows)),
    aiIntegration(),
  ];
}
