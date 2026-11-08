/**
 * Pure amount keypad input logic for Where Did It Go?
 * Follows PRD v4.0 Section 5.1 and AGENTS.md rules.
 *
 * Rules:
 * - Amount is kept as a STRING while typing.
 * - No leading zeros ("007" becomes "7", "00" remains "0").
 * - At most the currency's decimals after the point.
 * - One decimal point only.
 * - A leading point becomes "0.".
 * - Ignore any key that would cause the minor units to exceed MAX_AMOUNT.
 * - Backspace removes one character.
 * - On save convert with parseAmountToMinorUnits (never parseFloat, never * 100).
 */

import { MAX_AMOUNT } from './money';

export type KeypadAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'set'; value: string };

/**
 * Checks whether a candidate decimal string would exceed MAX_AMOUNT
 * when converted to minor units with the specified decimal precision.
 */
export function wouldExceedMaxAmount(candidate: string, decimals: number): boolean {
  if (!candidate) return false;
  const dotIdx = candidate.indexOf('.');
  const intPart = dotIdx === -1 ? candidate : candidate.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : candidate.slice(dotIdx + 1);

  const effectiveFrac = decimals > 0 ? fracPart.slice(0, decimals).padEnd(decimals, '0') : '';
  const minorStr = (intPart + effectiveFrac).replace(/^0+/, '');
  if (minorStr.length === 0) return false;

  const MAX_STR = MAX_AMOUNT.toString(); // '9007199254740991'
  if (minorStr.length > MAX_STR.length) return true;
  if (minorStr.length < MAX_STR.length) return false;
  return minorStr > MAX_STR;
}

/**
 * Pure reducer handling keypad actions on the raw amount string.
 */
export function amountKeypadReducer(
  state: string,
  action: KeypadAction,
  decimals: number = 2
): string {
  switch (action.type) {
    case 'set':
      return action.value;

    case 'clear':
      return '';

    case 'backspace': {
      if (!state) return '';
      return state.slice(0, -1);
    }

    case 'decimal': {
      // Currency with 0 decimals cannot have a decimal point
      if (decimals <= 0) {
        return state;
      }
      // Only one decimal point allowed
      if (state.includes('.')) {
        return state;
      }
      // Leading decimal becomes "0."
      if (!state || state === '0') {
        return '0.';
      }
      return state + '.';
    }

    case 'digit': {
      const { digit } = action;
      if (!/^[0-9]$/.test(digit)) {
        return state;
      }

      // If already has decimal point, check decimal places limit
      if (state.includes('.')) {
        const dotIdx = state.indexOf('.');
        const frac = state.slice(dotIdx + 1);
        if (frac.length >= decimals) {
          return state;
        }
      }

      let candidate: string;
      if (!state || state === '0') {
        // Disallow leading zeros: "0" + "0" remains "0", "0" + "7" becomes "7"
        candidate = digit;
      } else {
        candidate = state + digit;
      }

      if (wouldExceedMaxAmount(candidate, decimals)) {
        return state;
      }

      return candidate;
    }

    default:
      return state;
  }
}

/**
 * Convenience helper to apply a keypad key directly.
 */
export function applyKeypadKey(
  current: string,
  key: string,
  decimals: number = 2
): string {
  if (key === 'backspace') {
    return amountKeypadReducer(current, { type: 'backspace' }, decimals);
  }
  if (key === 'clear') {
    return amountKeypadReducer(current, { type: 'clear' }, decimals);
  }
  if (key === '.') {
    return amountKeypadReducer(current, { type: 'decimal' }, decimals);
  }
  if (/^[0-9]$/.test(key)) {
    return amountKeypadReducer(current, { type: 'digit', digit: key }, decimals);
  }
  return current;
}
