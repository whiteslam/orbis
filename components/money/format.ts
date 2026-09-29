const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

export const inr = (amount: number) => inrFormat.format(amount);
export const compactInr = (amount: number) => compactFormat.format(amount);
export const signedInr = (amount: number) => `${amount >= 0 ? '+' : '−'}${inr(Math.abs(amount))}`;
export const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
