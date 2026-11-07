import {
  MAX_AMOUNT,
  parseAmountToMinorUnits,
  formatMinorUnits,
  addMoney,
  sumMoney,
} from '../money';

describe('money.ts', () => {
  describe('parseAmountToMinorUnits', () => {
    it('parses valid inputs to minor units correctly without float math', () => {
      // Prompt required test cases:
      expect(parseAmountToMinorUnits('4.50', 2)).toEqual({ ok: true, value: 450 });
      expect(parseAmountToMinorUnits('4.5', 2)).toEqual({ ok: true, value: 450 });
      expect(parseAmountToMinorUnits('4', 2)).toEqual({ ok: true, value: 400 });
      expect(parseAmountToMinorUnits('0.01', 2)).toEqual({ ok: true, value: 1 });
      expect(parseAmountToMinorUnits('100', 0)).toEqual({ ok: true, value: 100 });
      expect(parseAmountToMinorUnits('  4.50  ', 2)).toEqual({ ok: true, value: 450 });

      // Max safe integer boundaries
      expect(parseAmountToMinorUnits('9007199254740991', 0)).toEqual({
        ok: true,
        value: 9007199254740991,
      });

      // Classic float trap values:
      expect(parseAmountToMinorUnits('1.15', 2)).toEqual({ ok: true, value: 115 });
      expect(parseAmountToMinorUnits('19.99', 2)).toEqual({ ok: true, value: 1999 });
    });

    it('rejects values with more decimals than the currency allows', () => {
      expect(parseAmountToMinorUnits('1.5', 0)).toEqual({
        ok: false,
        error: 'TOO_MANY_DECIMAL_PLACES',
      });
      expect(parseAmountToMinorUnits('4.505', 2)).toEqual({
        ok: false,
        error: 'TOO_MANY_DECIMAL_PLACES',
      });
    });

    it('rejects invalid, zero, negative, malformed, and non-numeric inputs', () => {
      const rejectedInputs = [
        '0',
        '0.00',
        '-1',
        '+1',
        '1e5',
        '1,000',
        'abc',
        '',
        '.',
        '1.',
        '.5', // Explicit decision: bare decimal rejected to avoid ambiguous entry
      ];

      for (const input of rejectedInputs) {
        const res = parseAmountToMinorUnits(input, 2);
        expect(res.ok).toBe(false);
      }
    });

    it('rejects amounts above MAX_AMOUNT (Number.MAX_SAFE_INTEGER)', () => {
      expect(parseAmountToMinorUnits('9007199254740992', 0)).toEqual({
        ok: false,
        error: 'EXCEEDS_MAX_AMOUNT',
      });
      expect(parseAmountToMinorUnits('9007199254740991.1', 1)).toEqual({
        ok: false,
        error: 'EXCEEDS_MAX_AMOUNT',
      });
    });

    it('rejects unsupported decimal places (< 0 or > 4)', () => {
      expect(parseAmountToMinorUnits('10', -1)).toEqual({
        ok: false,
        error: 'UNSUPPORTED_DECIMALS',
      });
      expect(parseAmountToMinorUnits('10', 5)).toEqual({
        ok: false,
        error: 'UNSUPPORTED_DECIMALS',
      });
      expect(parseAmountToMinorUnits('10', 2.5)).toEqual({
        ok: false,
        error: 'UNSUPPORTED_DECIMALS',
      });
    });
  });

  describe('formatMinorUnits', () => {
    it('formats minor units accurately without floating point division', () => {
      expect(formatMinorUnits(450, 2)).toBe('4.50');
      expect(formatMinorUnits(1, 2)).toBe('0.01');
      expect(formatMinorUnits(0, 2)).toBe('0.00');
      expect(formatMinorUnits(100, 0)).toBe('100');
      expect(formatMinorUnits(12345, 3)).toBe('12.345');
      expect(formatMinorUnits(-450, 2)).toBe('-4.50');
    });

    it('supports round trips for decimals 0, 2, and 3', () => {
      const testCases: { str: string; decimals: number }[] = [
        { str: '500', decimals: 0 },
        { str: '10', decimals: 0 },
        { str: '4.50', decimals: 2 },
        { str: '0.01', decimals: 2 },
        { str: '99.99', decimals: 2 },
        { str: '1.250', decimals: 3 },
        { str: '0.005', decimals: 3 },
      ];

      for (const { str, decimals } of testCases) {
        const parsed = parseAmountToMinorUnits(str, decimals);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          const formatted = formatMinorUnits(parsed.value, decimals);
          expect(formatted).toBe(str);
        }
      }
    });

    it('throws on non-integer amounts or invalid decimals', () => {
      expect(() => formatMinorUnits(4.5, 2)).toThrow(TypeError);
      expect(() => formatMinorUnits(NaN, 2)).toThrow(TypeError);
      expect(() => formatMinorUnits(100, -1)).toThrow(RangeError);
      expect(() => formatMinorUnits(100, 5)).toThrow(RangeError);
    });
  });

  describe('addMoney and sumMoney', () => {
    it('solves classic float traps exactly: 0.1 + 0.2 equals 0.30', () => {
      const p1 = parseAmountToMinorUnits('0.1', 2);
      const p2 = parseAmountToMinorUnits('0.2', 2);
      expect(p1.ok).toBe(true);
      expect(p2.ok).toBe(true);

      if (p1.ok && p2.ok) {
        const sum = addMoney(p1.value, p2.value);
        expect(sum).toBe(30);
        expect(formatMinorUnits(sum, 2)).toBe('0.30');
      }
    });

    it('sums arrays of monetary amounts with sumMoney', () => {
      expect(sumMoney([])).toBe(0);
      expect(sumMoney([100, 200, 350])).toBe(650);
    });

    it('throws when addMoney or sumMoney exceeds MAX_AMOUNT', () => {
      expect(() => addMoney(MAX_AMOUNT, 1)).toThrow(RangeError);
      expect(() => addMoney(MAX_AMOUNT - 5, 10)).toThrow(RangeError);
      expect(() => sumMoney([MAX_AMOUNT - 10, 5, 10])).toThrow(RangeError);
    });

    it('throws TypeError for non-safe-integer inputs', () => {
      expect(() => addMoney(1.5, 2)).toThrow(TypeError);
      expect(() => addMoney(1, NaN)).toThrow(TypeError);
    });
  });
});
