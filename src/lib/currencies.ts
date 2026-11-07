/**
 * Supported currencies for Where Did It Go? (PRD v4.0 Section 5.1 & 5.2).
 * Decimal precision is derived from ISO 4217 minor units.
 *
 * NOTE: PRD Section 5.2 - No exchange-rate conversion exists in v1.
 * Currency selection applies to the entire account and can only be
 * changed before any financial records exist.
 */

export interface SupportedCurrency {
  code: string;
  name: string;
  decimals: number;
  symbol: string;
}

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  { code: 'INR', name: 'Indian Rupee', decimals: 2, symbol: '₹' },
  { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€' },
  { code: 'GBP', name: 'British Pound', decimals: 2, symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', decimals: 0, symbol: '¥' },
  { code: 'AED', name: 'UAE Dirham', decimals: 2, symbol: 'د.إ' },
  { code: 'CAD', name: 'Canadian Dollar', decimals: 2, symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', decimals: 2, symbol: 'A$' },
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

export function getCurrency(code: string): SupportedCurrency | undefined {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code);
}
