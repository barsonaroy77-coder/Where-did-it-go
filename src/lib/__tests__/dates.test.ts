import {
  isValidDateString,
  todayLocal,
  firstOfMonth,
  monthKey,
  addMonths,
  monthRange,
  resolveRelativeDate,
  isLeapYear,
} from '../dates';

describe('dates.ts', () => {
  describe('isValidDateString and isLeapYear', () => {
    it('checks leap years correctly', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2025)).toBe(false);
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(1900)).toBe(false);
    });

    it('validates leap years and calendar dates correctly', () => {
      // Leap day 2024-02-29 valid
      expect(isValidDateString('2024-02-29')).toBe(true);

      // 2025-02-29 invalid (not a leap year)
      expect(isValidDateString('2025-02-29')).toBe(false);

      // Centurial leap years
      expect(isValidDateString('2000-02-29')).toBe(true);
      expect(isValidDateString('1900-02-29')).toBe(false);

      // Month bounds
      expect(isValidDateString('2026-13-01')).toBe(false);
      expect(isValidDateString('2026-00-10')).toBe(false);

      // Format strictly requires YYYY-MM-DD (two-digit month and day)
      expect(isValidDateString('2026-1-1')).toBe(false);
      expect(isValidDateString('2026-01-1')).toBe(false);
      expect(isValidDateString('2026-1-01')).toBe(false);
      expect(isValidDateString('26-01-01')).toBe(false);
      expect(isValidDateString('not-a-date')).toBe(false);

      // 30-day month check
      expect(isValidDateString('2026-04-30')).toBe(true);
      expect(isValidDateString('2026-04-31')).toBe(false);
    });
  });

  describe('todayLocal', () => {
    it('returns a valid local calendar date string matching YYYY-MM-DD', () => {
      const today = todayLocal();
      expect(isValidDateString(today)).toBe(true);
    });
  });

  describe('firstOfMonth and monthKey', () => {
    it('extracts first of the month correctly', () => {
      expect(firstOfMonth('2026-11-25')).toBe('2026-11-01');
      expect(firstOfMonth('2026-11')).toBe('2026-11-01');
      expect(firstOfMonth('2024-02-29')).toBe('2024-02-01');
    });

    it('extracts monthKey (YYYY-MM)', () => {
      expect(monthKey('2026-11-25')).toBe('2026-11');
      expect(monthKey('2026-11')).toBe('2026-11');
    });

    it('throws on invalid input for firstOfMonth / monthKey', () => {
      expect(() => firstOfMonth('invalid')).toThrow(RangeError);
      expect(() => monthKey('invalid')).toThrow(RangeError);
    });
  });

  describe('addMonths', () => {
    it('adds months correctly across a year', () => {
      expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
      expect(addMonths('2027-02-01', -3)).toBe('2026-11-01');
      expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
      expect(addMonths('2026-01-15', -12)).toBe('2025-01-15');
    });

    it('works with month keys (YYYY-MM)', () => {
      expect(addMonths('2026-11', 2)).toBe('2027-01');
      expect(addMonths('2027-01', -2)).toBe('2026-11');
    });

    it('clamps the day if the target month has fewer days', () => {
      // 2024 is a leap year (Feb has 29 days)
      expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');

      // 2025 is not a leap year (Feb has 28 days)
      expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');

      // March 31 to April (30 days)
      expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    });
  });

  describe('monthRange', () => {
    it('returns inclusive start and end for February in leap and non-leap years', () => {
      // February in leap year
      expect(monthRange('2024-02-01')).toEqual({
        start: '2024-02-01',
        end: '2024-02-29',
      });
      expect(monthRange('2024-02')).toEqual({
        start: '2024-02-01',
        end: '2024-02-29',
      });

      // February in non-leap year
      expect(monthRange('2025-02-01')).toEqual({
        start: '2025-02-01',
        end: '2025-02-28',
      });
      expect(monthRange('2025-02')).toEqual({
        start: '2025-02-01',
        end: '2025-02-28',
      });
    });

    it('returns correct range for 30 and 31 day months', () => {
      expect(monthRange('2026-04-15')).toEqual({
        start: '2026-04-01',
        end: '2026-04-30',
      });
      expect(monthRange('2026-12-01')).toEqual({
        start: '2026-12-01',
        end: '2026-12-31',
      });
    });
  });

  describe('resolveRelativeDate', () => {
    it('resolves "today" and "yesterday" using calendar math without timezone shifts', () => {
      expect(resolveRelativeDate('today', '2026-11-07')).toBe('2026-11-07');
      expect(resolveRelativeDate('TODAY', '2026-11-07')).toBe('2026-11-07');
      expect(resolveRelativeDate('yesterday', '2026-11-07')).toBe('2026-11-06');

      // Yesterday at beginning of month: rolls back to previous month's last day
      expect(resolveRelativeDate('yesterday', '2026-03-01')).toBe('2026-02-28');

      // Yesterday across leap year Feb
      expect(resolveRelativeDate('yesterday', '2024-03-01')).toBe('2024-02-29');

      // Yesterday across year boundary
      expect(resolveRelativeDate('yesterday', '2026-01-01')).toBe('2025-12-31');
    });

    it('returns null for any other word', () => {
      expect(resolveRelativeDate('tomorrow', '2026-11-07')).toBeNull();
      expect(resolveRelativeDate('last week', '2026-11-07')).toBeNull();
      expect(resolveRelativeDate('monday', '2026-11-07')).toBeNull();
      expect(resolveRelativeDate('', '2026-11-07')).toBeNull();
    });
  });
});
