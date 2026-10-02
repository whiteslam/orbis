'use client';

import { QuietList } from '@/components/field/field';
import { money } from '@/lib/finance/money';
import type { OwnInvestments } from '@/lib/finance/types';

/**
 * FDs, RDs, SIPs and the rest you recorded yourself under Spending → Add
 * manually → Investment. No broker reports these, so this is the only place
 * they are counted towards what you hold.
 */
export function OwnInvestmentsList({ own }: { own: OwnInvestments }) {
  if (own.categories.length === 0) {
    return (
      <section className="fd-quiet">
        <h2>Your own entries</h2>
        <p className="fd-hint">FDs, RDs, SIPs or gold you pay for yourself: add them in Spending → Add manually → Investment, and they appear here.</p>
      </section>
    );
  }
  return (
    <QuietList
      heading={`Your own entries · ${money(own.total, own.currency)}`}
      rows={own.categories.map((entry) => ({
        label: entry.count === 1 ? entry.category : `${entry.category} · ${entry.count} entries`,
        value: money(entry.amount, own.currency),
        empty: false,
        target: null,
      }))}
    />
  );
}
