import {
  amountKeypadReducer,
  applyKeypadKey,
  wouldExceedMaxAmount,
} from '../amountKeypad';
import { MAX_AMOUNT } from '../money';

describe('amountKeypadReducer', () => {
  describe('Rule 1: String-based entry & No leading zeros', () => {
    it('initializes and enters first digit', () => {
      let state = '';
      state = amountKeypadReducer(state, { type: 'digit', digit: '7' }, 2);
      expect(state).toBe('7');
    });

    it('prevents multiple leading zeros: "0" + "0" remains "0"', () => {
      let state = '0';
      state = amountKeypadReducer(state, { type: 'digit', digit: '0' }, 2);
      expect(state).toBe('0');
    });

    it('replaces leading zero with digit: "007" becomes "7"', () => {
      let state = '';
      state = amountKeypadReducer(state, { type: 'digit', digit: '0' }, 2);
      expect(state).toBe('0');
      state = amountKeypadReducer(state, { type: 'digit', digit: '0' }, 2);
      expect(state).toBe('0');
      state = amountKeypadReducer(state, { type: 'digit', digit: '7' }, 2);
      expect(state).toBe('7');
    });

    it('appends digits normally when non-zero: "7" + "5" becomes "75"', () => {
      let state = '7';
      state = amountKeypadReducer(state, { type: 'digit', digit: '5' }, 2);
      expect(state).toBe('75');
      state = amountKeypadReducer(state, { type: 'digit', digit: '0' }, 2);
      expect(state).toBe('750');
    });
  });

  describe('Rule 2: Decimal point rules', () => {
    it('turns leading point into "0."', () => {
      let state = '';
      state = amountKeypadReducer(state, { type: 'decimal' }, 2);
      expect(state).toBe('0.');
    });

    it('turns "0" with decimal into "0."', () => {
      let state = '0';
      state = amountKeypadReducer(state, { type: 'decimal' }, 2);
      expect(state).toBe('0.');
    });

    it('appends decimal point after digits', () => {
      let state = '42';
      state = amountKeypadReducer(state, { type: 'decimal' }, 2);
      expect(state).toBe('42.');
    });

    it('enforces one decimal point only (subsequent points ignored)', () => {
      let state = '42.';
      state = amountKeypadReducer(state, { type: 'decimal' }, 2);
      expect(state).toBe('42.');

      state = '42.5';
      state = amountKeypadReducer(state, { type: 'decimal' }, 2);
      expect(state).toBe('42.5');
    });

    it('ignores decimal point when currency has 0 decimals (e.g. JPY)', () => {
      let state = '500';
      state = amountKeypadReducer(state, { type: 'decimal' }, 0);
      expect(state).toBe('500');

      state = '';
      state = amountKeypadReducer(state, { type: 'decimal' }, 0);
      expect(state).toBe('');
    });
  });

  describe('Rule 3: Decimals precision limit', () => {
    it('limits fractional digits to currency decimals (2 decimals)', () => {
      let state = '10.';
      state = amountKeypadReducer(state, { type: 'digit', digit: '9' }, 2);
      expect(state).toBe('10.9');
      state = amountKeypadReducer(state, { type: 'digit', digit: '9' }, 2);
      expect(state).toBe('10.99');
      // Third decimal should be ignored
      state = amountKeypadReducer(state, { type: 'digit', digit: '5' }, 2);
      expect(state).toBe('10.99');
    });

    it('handles 3 decimals precision', () => {
      let state = '10.';
      state = amountKeypadReducer(state, { type: 'digit', digit: '1' }, 3);
      state = amountKeypadReducer(state, { type: 'digit', digit: '2' }, 3);
      state = amountKeypadReducer(state, { type: 'digit', digit: '3' }, 3);
      expect(state).toBe('10.123');
      // 4th decimal ignored
      state = amountKeypadReducer(state, { type: 'digit', digit: '4' }, 3);
      expect(state).toBe('10.123');
    });
  });

  describe('Rule 4: MAX_AMOUNT boundary enforcement', () => {
    it('allows typing up to MAX_AMOUNT', () => {
      // MAX_AMOUNT = 9007199254740991
      // With 2 decimals: 90071992547409.91
      const maxWithDecimals = '90071992547409.91';
      expect(wouldExceedMaxAmount(maxWithDecimals, 2)).toBe(false);

      // Exceeding by 0.01
      const exceeding = '90071992547409.92';
      expect(wouldExceedMaxAmount(exceeding, 2)).toBe(true);

      const state = '90071992547409.9';
      const nextState = amountKeypadReducer(state, { type: 'digit', digit: '2' }, 2);
      // Digit '2' would exceed MAX_AMOUNT, so it must be ignored
      expect(nextState).toBe('90071992547409.9');
    });

    it('ignores digit when whole units would exceed MAX_AMOUNT in minor units', () => {
      // 90071992547410 with 2 decimals -> 9007199254741000 > MAX_AMOUNT
      const state = '9007199254741';
      const nextState = amountKeypadReducer(state, { type: 'digit', digit: '0' }, 2);
      expect(nextState).toBe('9007199254741');
    });

    it('enforces MAX_AMOUNT with 0 decimals (e.g. JPY)', () => {
      const maxStr = MAX_AMOUNT.toString(); // 9007199254740991
      expect(wouldExceedMaxAmount(maxStr, 0)).toBe(false);
      expect(wouldExceedMaxAmount('9007199254740992', 0)).toBe(true);

      const state = '900719925474099';
      const allowed = amountKeypadReducer(state, { type: 'digit', digit: '1' }, 0);
      expect(allowed).toBe('9007199254740991');

      const rejected = amountKeypadReducer(state, { type: 'digit', digit: '2' }, 0);
      expect(rejected).toBe('900719925474099');
    });
  });

  describe('Rule 5: Backspace & Clear', () => {
    it('backspace removes one character', () => {
      expect(amountKeypadReducer('123', { type: 'backspace' }, 2)).toBe('12');
      expect(amountKeypadReducer('12', { type: 'backspace' }, 2)).toBe('1');
      expect(amountKeypadReducer('1', { type: 'backspace' }, 2)).toBe('');
      expect(amountKeypadReducer('', { type: 'backspace' }, 2)).toBe('');
    });

    it('backspace removes decimal point and leading zero', () => {
      expect(amountKeypadReducer('0.5', { type: 'backspace' }, 2)).toBe('0.');
      expect(amountKeypadReducer('0.', { type: 'backspace' }, 2)).toBe('0');
      expect(amountKeypadReducer('0', { type: 'backspace' }, 2)).toBe('');
    });

    it('clear resets amount to empty string', () => {
      expect(amountKeypadReducer('450.75', { type: 'clear' }, 2)).toBe('');
      expect(amountKeypadReducer('', { type: 'clear' }, 2)).toBe('');
    });

    it('set action updates to specified value', () => {
      expect(amountKeypadReducer('10', { type: 'set', value: '54.20' }, 2)).toBe('54.20');
    });
  });

  describe('applyKeypadKey convenience helper', () => {
    it('applies digits, decimal, backspace, and clear', () => {
      let state = '';
      state = applyKeypadKey(state, '4', 2);
      state = applyKeypadKey(state, '2', 2);
      state = applyKeypadKey(state, '.', 2);
      state = applyKeypadKey(state, '5', 2);
      state = applyKeypadKey(state, '0', 2);
      expect(state).toBe('42.50');

      state = applyKeypadKey(state, 'backspace', 2);
      expect(state).toBe('42.5');

      state = applyKeypadKey(state, 'clear', 2);
      expect(state).toBe('');
    });

    it('ignores unknown or invalid keys', () => {
      expect(applyKeypadKey('42', 'abc', 2)).toBe('42');
      expect(applyKeypadKey('42', '', 2)).toBe('42');
    });
  });
});
