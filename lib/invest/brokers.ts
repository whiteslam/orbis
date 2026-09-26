// Every account Orbis can read holdings from. Client-safe: display metadata only,
// no credentials and no server imports.
//
// Adding a provider is three edits and nothing else: an entry here, a client in
// lib/invest/<id>.ts, and a loader registered in lib/invest/live.ts. The Invest
// screen renders whatever this list contains, so no component, style or copy is
// written against one broker.
export type BrokerId = 'groww' | 'zerodha';

export type BrokerMeta = {
  id: BrokerId;
  name: string;
  logo: string;
  /** What a connection brings in, in the user's words. */
  covers: string;
  /** Where the user generates the credentials. */
  keysUrl: string;
  keysLabel: string;
  /** The two secrets the connect form asks for. */
  fields: { key: string; secret: string; keyPlaceholder: string };
  /** Where the prices behind these holdings come from. */
  priceNote: string;
  /** The same, in a few words for the connect screen's "What syncs" rows. */
  pricesShort: string;
  /** What this connection cannot bring in, so a gap is never a mystery. */
  gapNote?: string;
  /**
   * How the account is linked.
   *
   * 'keys' takes an API key and secret straight from the user. 'redirect' sends
   * them to the broker to log in and comes back with a session, which is the
   * only way Kite Connect works and which expires daily.
   */
  connect: 'keys' | 'redirect';
  /** For 'redirect' brokers: where the connect button points. */
  connectPath?: string;
  /** Said plainly on the card, because a daily reconnect is not a fault. */
  sessionNote?: string;
};

export const BROKERS: BrokerMeta[] = [
  {
    id: 'groww',
    name: 'Groww',
    logo: '/brands/groww.png',
    covers: 'stocks and ETFs',
    keysUrl: 'https://groww.in/trade-api/api-keys',
    keysLabel: 'Groww → Trade API keys',
    fields: { key: 'API key', secret: 'API secret', keyPlaceholder: 'eyJraWQiOi…' },
    priceNote: 'Prices: NAV from AMFI for ETFs (published daily), BSE quotes from Alpha Vantage for shares.',
    pricesShort: 'AMFI NAV · BSE quotes',
    gapNote: 'Mutual funds aren’t available through the Groww Trade API.',
    connect: 'keys',
  },
];

export const BROKER_IDS = BROKERS.map((broker) => broker.id);

export function brokerMeta(id: BrokerId): BrokerMeta {
  return BROKERS.find((broker) => broker.id === id) ?? BROKERS[0];
}

export const isBrokerId = (value: unknown): value is BrokerId => typeof value === 'string' && BROKER_IDS.includes(value as BrokerId);
