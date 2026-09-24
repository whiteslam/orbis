import { getAuthenticatedUserId } from '@/lib/gmail/oauth';
import { friendlyProviderMessage } from '@/lib/providers/core';
import { getRates, isSupportedCurrency } from '@/lib/providers/currency';

// GET /api/currency?base=USD&symbols=INR,EUR
export async function GET(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return Response.json({ error: 'Sign in again to see exchange rates.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const base = (params.get('base') ?? 'USD').toUpperCase();
  const symbols = (params.get('symbols') ?? 'INR').toUpperCase().split(',').filter(Boolean).slice(0, 10);
  if (!isSupportedCurrency(base) || !symbols.length || !symbols.every(isSupportedCurrency)) {
    return Response.json({ error: 'Choose supported three-letter currency codes.' }, { status: 400 });
  }

  try {
    const result = await getRates(base);
    const rates = Object.fromEntries(symbols.filter((code) => code !== base).map((code) => [code, result.data.rates[code] ?? null]));
    return Response.json({ base, date: result.data.date, rates, fetchedAt: result.fetchedAt, stale: result.stale }, { headers: { 'cache-control': 'private, max-age=3600' } });
  } catch (error) {
    return Response.json({ error: friendlyProviderMessage(error) }, { status: 503 });
  }
}
