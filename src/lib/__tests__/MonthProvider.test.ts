import {
  getPreviousMonth,
  getNextMonth,
} from '../MonthProvider';

describe('MonthProvider pure functions', () => {
  const currentMonth = '2026-11-01';

  test('getPreviousMonth steps back one calendar month', () => {
    expect(getPreviousMonth('2026-11-01')).toBe('2026-10-01');
    expect(getPreviousMonth('2026-01-01')).toBe('2025-12-01');
    expect(getPreviousMonth('2024-03-01')).toBe('2024-02-01');
  });

  test('getNextMonth steps forward one calendar month when before current month', () => {
    expect(getNextMonth('2026-09-01', currentMonth)).toBe('2026-10-01');
    expect(getNextMonth('2026-10-01', currentMonth)).toBe('2026-11-01');
  });

  test('getNextMonth cannot advance past the current month (clamping)', () => {
    expect(getNextMonth('2026-11-01', currentMonth)).toBe('2026-11-01');
    expect(getNextMonth('2026-12-01', currentMonth)).toBe('2026-12-01');
  });
});
