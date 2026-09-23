import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { FinanceSummary } from '@/lib/finance/types';

const emptySummary: FinanceSummary = {
  databaseReady: true,
  loadError: false,
  connection: null,
  pendingCandidateCount: 0,
  unparsedCandidateCount: 0,
  reviewCandidates: [],
  transactions: [],
  monthlyExpenses: [],
};

function isMissingTable(error: { code?: string }) {
  return error.code === 'PGRST205' || error.code === 'PGRST204' || error.code === '42P01';
}

export async function getFinanceSummary(userId: string): Promise<FinanceSummary> {
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: connection, error: connectionError } = await admin
    .from('gmail_connections')
    .select('id, google_email, status, last_sync_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (connectionError) {
    const missing = isMissingTable(connectionError);
    return { ...emptySummary, databaseReady: !missing, loadError: !missing };
  }

  let pendingCandidateCount = 0;
  let unparsedCandidateCount = 0;
  let reviewCandidates: FinanceSummary['reviewCandidates'] = [];
  if (connection) {
    const [{ count, error }, { count: unparsedCount, error: unparsedError }, { data: reviewData, error: reviewError }] = await Promise.all([
      admin
      .from('gmail_sync_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('connection_id', connection.id)
      .eq('sync_state', 'pending'),
      admin
        .from('gmail_sync_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('connection_id', connection.id)
        .eq('sync_state', 'pending')
        .eq('parse_status', 'unparsed'),
      admin
        .from('gmail_sync_messages')
        .select('id, received_at, parse_status, parsed_amount, parsed_currency, parsed_direction, parsed_merchant, parse_reason')
        .eq('user_id', userId)
        .eq('connection_id', connection.id)
        .eq('sync_state', 'pending')
        .in('parse_status', ['needs_review', 'unrecognized'])
        .order('received_at', { ascending: false })
        .limit(8),
    ]);

    if (error || unparsedError || reviewError) {
      const currentError = error ?? unparsedError ?? reviewError;
      const missing = currentError ? isMissingTable(currentError) : false;
      return { ...emptySummary, databaseReady: !missing, loadError: !missing };
    }
    pendingCandidateCount = count ?? 0;
    unparsedCandidateCount = unparsedCount ?? 0;
    reviewCandidates = (reviewData ?? []).map((candidate) => ({
      id: candidate.id,
      receivedAt: candidate.received_at,
      parseStatus: candidate.parse_status as 'needs_review' | 'unrecognized',
      amount: candidate.parsed_amount === null ? null : Number(candidate.parsed_amount),
      currency: candidate.parsed_currency,
      direction: candidate.parsed_direction as 'expense' | 'income' | null,
      merchant: candidate.parsed_merchant,
      reason: candidate.parse_reason,
    }));
  }

  const now = new Date();
  const monthParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(monthParts.find((part) => part.type === 'year')?.value);
  const month = Number(monthParts.find((part) => part.type === 'month')?.value);
  const start = new Date(Date.UTC(year, month - 1, 1) - 330 * 60 * 1000);

  const [transactionsResult, expensesResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, amount, currency, direction, merchant, category, occurred_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(8),
    supabase
      .from('transactions')
      .select('amount, currency')
      .eq('user_id', userId)
      .eq('direction', 'expense')
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', now.toISOString()),
  ]);

  if (transactionsResult.error || expensesResult.error) {
    const error = transactionsResult.error ?? expensesResult.error;
    const missing = !error || isMissingTable(error);
    return { ...emptySummary, databaseReady: !missing, loadError: Boolean(error) && !missing };
  }

  const totals = new Map<string, number>();
  for (const transaction of expensesResult.data ?? []) {
    totals.set(transaction.currency, (totals.get(transaction.currency) ?? 0) + Number(transaction.amount));
  }

  return {
    databaseReady: true,
    loadError: false,
    connection: connection ? {
      email: connection.google_email,
      status: connection.status,
      lastSyncAt: connection.last_sync_at,
    } : null,
    pendingCandidateCount,
    unparsedCandidateCount,
    reviewCandidates,
    transactions: (transactionsResult.data ?? []).map((transaction) => ({
      id: transaction.id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      direction: transaction.direction,
      merchant: transaction.merchant,
      category: transaction.category,
      occurredAt: transaction.occurred_at,
    })),
    monthlyExpenses: Array.from(totals, ([currency, amount]) => ({ currency, amount })),
  };
}
