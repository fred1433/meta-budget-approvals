// Meta's daily_budget is an integer in the account currency's smallest unit (cents for USD).
export function dollarsToCents(d) {
  const c = Math.round(d * 100);
  if (Math.abs(c - d * 100) > 1e-6) throw new Error(`Not a whole number of cents: ${d}`);
  return c;
}
export function centsParam(cents) {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`daily_budget must be a positive integer of cents, got ${cents}`);
  return String(cents);
}
export function usd(cents, { whole = false } = {}) {
  const v = cents / 100;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
