// From a broker's symbol (Zerodha, Groww) or what the owner typed to the
// Yahoo ticker TradingAgents reads: RELIANCE → RELIANCE.NS, a BSE scrip code
// → 500325.BO. Indian listings only. Client-safe and pure; the worker has the
// same rules in workers/research-desk/research_desk/tickers.py.

import type { AssetClass } from '@/lib/invest/analysis';
import type { Exchange } from '@/lib/research/types';

export type ResearchTarget =
  | { ok: true; ticker: string; exchange: Exchange; symbol: string }
  | { ok: false; reason: 'fund' | 'unsupported' };

const TICKER = /^[A-Z0-9&-]{1,20}\.(NS|BO)$/;
const LISTED = /^[A-Z0-9&-]{1,20}$/;
const BSE_CODE = /^\d{6}$/;
// Zerodha appends the trading series to some symbols (SBIN-BE); Yahoo doesn't.
const SERIES = /-(EQ|BE|BZ|BL|SM|ST|IL|IV|GB|GS)$/;

export const isResearchTicker = (value: unknown): value is string => typeof value === 'string' && TICKER.test(value);

/** A bare listed symbol to its ticker, or null when it isn't one. */
function fromSymbol(raw: string, exchange?: Exchange): { ticker: string; exchange: Exchange } | null {
  const symbol = raw.trim().toUpperCase().replace(SERIES, '');
  if (!LISTED.test(symbol)) return null;
  const on: Exchange = exchange ?? (BSE_CODE.test(symbol) ? 'BSE' : 'NSE');
  const ticker = `${symbol}.${on === 'BSE' ? 'BO' : 'NS'}`;
  return isResearchTicker(ticker) ? { ticker, exchange: on } : null;
}

/**
 * A holding the desk can analyse. Mutual funds are a large part of most Groww
 * books, but TradingAgents reads exchange prices, so they are named as not
 * supported rather than quietly left out. Fund units carry an INF ISIN; an
 * exchange-traded fund (NIFTYBEES) has a listed symbol, a scheme doesn't.
 */
export function researchTarget(holding: { symbol: string; isin: string | null; assetClass: AssetClass }): ResearchTarget {
  if (holding.assetClass === 'Mutual funds') return { ok: false, reason: 'fund' };
  const symbol = holding.symbol.trim();
  const listed = fromSymbol(symbol);
  if (!listed) {
    return holding.isin?.toUpperCase().startsWith('INF') ? { ok: false, reason: 'fund' } : { ok: false, reason: 'unsupported' };
  }
  return { ok: true, ...listed, symbol: symbol.toUpperCase() };
}

/** What the owner typed: RELIANCE, reliance.ns, NSE:INFY, BSE:500325 or 500325. */
export function parseTypedTicker(input: string): ResearchTarget {
  const text = input.trim().toUpperCase();
  if (!text || text.length > 40) return { ok: false, reason: 'unsupported' };
  const prefixed = /^(NSE|BSE)\s*:\s*(.+)$/.exec(text);
  if (prefixed) {
    const listed = fromSymbol(prefixed[2], prefixed[1] as Exchange);
    return listed ? { ok: true, ...listed, symbol: prefixed[2].trim() } : { ok: false, reason: 'unsupported' };
  }
  const suffixed = /^(.+)\.(NS|BO)$/.exec(text);
  if (suffixed) {
    const listed = fromSymbol(suffixed[1], suffixed[2] === 'BO' ? 'BSE' : 'NSE');
    return listed ? { ok: true, ...listed, symbol: suffixed[1] } : { ok: false, reason: 'unsupported' };
  }
  const listed = fromSymbol(text);
  return listed ? { ok: true, ...listed, symbol: text } : { ok: false, reason: 'unsupported' };
}
