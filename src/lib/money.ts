/**
 * Pure monetary math and string parsing utilities for Where Did It Go?
 * Follows PRD v4.0 Section 5.1 and AGENTS.md rules.
 *
 * All money is represented internally as positive integer minor units (cents/paise).
 * NO floating-point arithmetic is used for money conversion or calculations.
 */

export const MAX_AMOUNT = 9007199254740991; // Number.MAX_SAFE_INTEGER

export type MoneyParseErrorCode =
  | 'EMPTY_INPUT'
  | 'INVALID_FORMAT'
  | 'ZERO_NOT_ALLOWED'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'UNSUPPORTED_DECIMALS'
  | 'TOO_MANY_DECIMAL_PLACES'
  | 'EXCEEDS_MAX_AMOUNT';

export type MoneyParseResult =
  | { ok: true; value: number }
  | { ok: false; error: MoneyParseErrorCode };

/**
 * Parses user string input into minor units (integer cents/paise).
 * STRING-BASED conversion only (split on decimal point, never parseFloat or multiplication).
 *
 * Rules:
 * - Decimals must be an integer between 0 and 4 (JPY = 0, INR/USD = 2).
 * - Accept only digits with at most one "." as decimal separator, trimmed.
 * - Reject: empty, zero, negative, "+" or "-" signs, exponent notation, letters,
 *   commas, more than one ".", more decimal places than allowed, "." with no digits,
 *   and values above MAX_AMOUNT.
 *
 * Decision on ".5" and "1.":
 * - ".5" is REJECTED. In financial applications, requiring an explicit whole-unit
 *   digit (e.g. "0.5") prevents input accidents and ambiguity.
 * - "1." is REJECTED. A decimal point without trailing fractional digits is malformed.
 */
export function parseAmountToMinorUnits(
  input: string,
  decimals: number
): MoneyParseResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'INVALID_FORMAT' };
  }

  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 4
  ) {
    return { ok: false, error: 'UNSUPPORTED_DECIMALS' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'EMPTY_INPUT' };
  }

  if (trimmed.startsWith('-')) {
    return { ok: false, error: 'NEGATIVE_NOT_ALLOWED' };
  }

  if (trimmed.startsWith('+')) {
    return { ok: false, error: 'INVALID_FORMAT' };
  }

  // Strictly require at least one leading digit, and if a dot is present, at least one trailing digit.
  // This cleanly rejects ".", "1.", ".5", letters, commas, multiple dots, and exponents.
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
    return { ok: false, error: 'INVALID_FORMAT' };
  }

  const dotIndex = trimmed.indexOf('.');
  let intPart = trimmed;
  let fracPart = '';

  if (dotIndex !== -1) {
    if (decimals === 0) {
      return { ok: false, error: 'TOO_MANY_DECIMAL_PLACES' };
    }
    intPart = trimmed.slice(0, dotIndex);
    fracPart = trimmed.slice(dotIndex + 1);

    if (fracPart.length > decimals) {
      return { ok: false, error: 'TOO_MANY_DECIMAL_PLACES' };
    }
    fracPart = fracPart.padEnd(decimals, '0');
  } else if (decimals > 0) {
    fracPart = ''.padEnd(decimals, '0');
  }

  const combined = intPart + fracPart;
  const stripped = combined.replace(/^0+/, '');

  if (stripped.length === 0) {
    return { ok: false, error: 'ZERO_NOT_ALLOWED' };
  }

  const MAX_STR = MAX_AMOUNT.toString(); // 16 digits: 9007199254740991
  if (
    stripped.length > MAX_STR.length ||
    (stripped.length === MAX_STR.length && stripped > MAX_STR)
  ) {
    return { ok: false, error: 'EXCEEDS_MAX_AMOUNT' };
  }

  const value = Number(stripped);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: 'EXCEEDS_MAX_AMOUNT' };
  }

  return { ok: true, value };
}

/**
 * Formats minor units (integer cents/paise) to a decimal string.
 * String-based conversion, absolutely NO floating-point division.
 * e.g. 450 with 2 decimals becomes "4.50".
 */
export function formatMinorUnits(amount: number, decimals: number): string {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    !Number.isInteger(amount)
  ) {
    throw new TypeError('Amount must be a finite integer in minor units');
  }
  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 4
  ) {
    throw new RangeError('Decimals must be an integer between 0 and 4');
  }

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const s = absAmount.toString();

  if (decimals === 0) {
    return (isNegative ? '-' : '') + s;
  }

  const padded = s.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);

  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Adds two monetary values in minor units.
 * Throws a RangeError if the sum exceeds MAX_AMOUNT.
 */
export function addMoney(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new TypeError('Inputs to addMoney must be safe integers');
  }
  const sum = a + b;
  if (sum > MAX_AMOUNT || sum < -MAX_AMOUNT || !Number.isSafeInteger(sum)) {
    throw new RangeError(`Sum exceeds MAX_AMOUNT (${MAX_AMOUNT})`);
  }
  return sum;
}

/**
 * Sums an array of monetary values in minor units.
 * Throws a RangeError if the cumulative sum exceeds MAX_AMOUNT.
 */
export function sumMoney(list: readonly number[]): number {
  let total = 0;
  for (const item of list) {
    total = addMoney(total, item);
  }
  return total;
}
