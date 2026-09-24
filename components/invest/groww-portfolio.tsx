'use client';

import Image from 'next/image';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { GrowwPortfolio as GrowwPortfolioData } from '@/lib/invest/types';
import { inr, signedInr } from '@/components/invest/format';

const SOURCE_LABEL = { groww: 'LTP', amfi: 'NAV', alpha_vantage: 'BSE', coingecko: 'Price' } as const;

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: value.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(date);
}

export function GrowwPortfolio({ portfolio, isLoading, onRefresh }: { portfolio: GrowwPortfolioData | null; isLoading: boolean; onRefresh: () => void }) {
  // Other Orbis accounts never see that a Groww connection exists.
  if (portfolio?.state === 'not_owner' || portfolio?.state === 'not_configured') return null;

  const holdings = portfolio?.holdings ?? [];

  return (
    <section className="groww-card" aria-labelledby="groww-title">
      <div className="groww-head">
        <div className="groww-icon"><Image src="/brands/groww.png" alt="Groww" width={24} height={24} /></div>
        <div><small>CONNECTED · READ-ONLY</small><h3 id="groww-title">Groww holdings</h3></div>
        <button className="groww-refresh" type="button" onClick={onRefresh} disabled={isLoading} aria-label="Refresh Groww holdings">
          {isLoading ? <LoaderCircle className="workbook-spinner" size={15} /> : <RefreshCw size={15} />}
        </button>
      </div>

      {!portfolio && <p className="groww-muted">Loading holdings from Groww…</p>}
      {portfolio?.state === 'owner_not_set' && <p className="finance-notice error">Groww keys are set, but GROWW_OWNER_EMAIL is empty. Add your Orbis sign-in email to the server environment so only you can see these holdings.</p>}
      {portfolio?.state === 'error' && <p className="finance-notice error">{portfolio.message}</p>}

      {portfolio?.state === 'ok' && (
        <>
          {holdings.length ? (
            <div className="groww-list">
              {holdings.map((holding) => {
                const cost = holding.quantity * holding.averagePrice;
                const value = holding.lastPrice === null ? null : holding.quantity * holding.lastPrice;
                return (
                  <div className="groww-row" key={holding.isin ?? holding.symbol}>
                    <div>
                      <strong>{holding.symbol}</strong>
                      <small>{holding.quantity.toLocaleString('en-IN')} shares · avg {inr(holding.averagePrice)}</small>
                      {holding.lastPrice !== null && holding.priceSource
                        ? <small className="groww-price">{SOURCE_LABEL[holding.priceSource]} {inr(holding.lastPrice)}{holding.priceAsOf ? ` · ${shortDate(holding.priceAsOf)}` : ''}{holding.priceStale ? ' · last saved' : ''}</small>
                        : <small className="groww-price missing">Price unavailable</small>}
                    </div>
                    <div className="groww-row-value">
                      <strong>{inr(value ?? cost)}</strong>
                      {value !== null ? <small className={value - cost >= 0 ? 'up' : 'down'}>{signedInr(value - cost)}</small> : <small>invested</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="groww-muted">No stock or ETF holdings in your Groww demat account.</p>}

          <p className="groww-muted">
            Prices: NAV from AMFI for ETFs (published daily), BSE quotes from Alpha Vantage for shares.
            {!portfolio.livePrices && ' Holdings without a price count at the amount invested.'}
            {' '}Mutual funds aren’t available through the Groww Trade API; add them below with their ISIN.
            {portfolio.fetchedAt && ` Updated ${new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(portfolio.fetchedAt))}.`}
          </p>
        </>
      )}
    </section>
  );
}
