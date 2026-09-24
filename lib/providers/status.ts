import 'server-only';

import { openRouterModel } from '@/lib/ai/openrouter';
import { growwConfigured, growwOwnerEmail } from '@/lib/invest/groww';
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

export async function getIntegrationStatus(userId: string, email: string | null): Promise<Integration[]> {
  let statusRows: StatusRow[] = [];
  let usageRows: Array<{ provider: string; calls: number }> = [];
  let gmail: { status: string; last_sync_at: string | null } | null = null;
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const [status, usage, connection] = await Promise.all([
      admin.from('api_provider_status').select('provider,last_success_at,last_error_at,last_error_kind'),
      admin.from('api_daily_usage').select('provider,calls').eq('usage_date', today),
      admin.from('gmail_connections').select('status,last_sync_at').eq('user_id', userId).maybeSingle(),
    ]);
    statusRows = (status.data ?? []) as StatusRow[];
    usageRows = (usage.data ?? []) as typeof usageRows;
    gmail = connection.data ?? null;
  } catch {
    // Show configuration only.
  }

  const integrations: Integration[] = [];

  const owner = growwOwnerEmail();
  if (growwConfigured() && owner && email === owner) {
    integrations.push({ id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: 'connected', detail: null, lastSyncAt: null, usage: null });
  } else if (!growwConfigured() || !owner) {
    integrations.push({ id: 'groww', label: 'Groww', purpose: 'Holdings · read-only', state: 'not_configured', detail: owner ? 'Add the API key and secret' : 'Set GROWW_OWNER_EMAIL', lastSyncAt: null, usage: null });
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
