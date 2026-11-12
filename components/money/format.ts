// Broker holdings are priced in rupees (Indian brokers), so the currency stays INR;
// the grouping and symbol placement follow the person's own language.
export const inr = (amount: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
export const compactInr = (amount: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(amount);
export const signedInr = (amount: number, locale: string) => `${amount >= 0 ? '+' : '−'}${inr(Math.abs(amount), locale)}`;
export const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
