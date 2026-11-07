/**
 * Pure date manipulation utilities for Where Did It Go?
 * Follows PRD v4.0 Section 5.4 and AGENTS.md rules.
 *
 * All dates are stored as YYYY-MM-DD strings, never timestamps.
 * A time-zone change must never shift an existing transaction's calendar date.
 */

/**
 * Checks whether a given year is a leap year in the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a given calendar month (1-12).
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    return 0;
  }
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Validates that a string is an exact, valid calendar date in YYYY-MM-DD format.
 * Rejects malformed strings (e.g. "2026-1-1", "2026-13-01", "2025-02-29").
 */
export function isValidDateString(s: string): boolean {
  if (typeof s !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }

  const [yStr, mStr, dStr] = s.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);

  if (y < 1000 || y > 9999) {
    return false;
  }
  if (m < 1 || m > 12) {
    return false;
  }

  const daysInMonth = getDaysInMonth(y, m);
  return d >= 1 && d <= daysInMonth;
}

/**
 * Returns the device's local date as a YYYY-MM-DD string.
 */
export function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the first day of the month (YYYY-MM-01) for a given date or month string.
 * Accepts "YYYY-MM-DD" or "YYYY-MM".
 */
export function firstOfMonth(dateOrMonth: string): string {
  if (typeof dateOrMonth !== 'string') {
    throw new TypeError('Input must be a string');
  }
  const match = dateOrMonth.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) {
    throw new RangeError(`Invalid date or month string: "${dateOrMonth}"`);
  }
  const [, yStr, mStr] = match;
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) {
    throw new RangeError(`Invalid month: "${mStr}"`);
  }
  return `${yStr}-${mStr}-01`;
}

/**
 * Returns the month key (YYYY-MM) for a date or month string.
 */
export function monthKey(dateOrMonth: string): string {
  if (typeof dateOrMonth !== 'string') {
    throw new TypeError('Input must be a string');
  }
  const match = dateOrMonth.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) {
    throw new RangeError(`Invalid date or month string: "${dateOrMonth}"`);
  }
  const [, yStr, mStr] = match;
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) {
    throw new RangeError(`Invalid month: "${mStr}"`);
  }
  return `${yStr}-${mStr}`;
}

/**
 * Adds n calendar months to a date or month string.
 * Preserves the day of month, clamping to the last valid day of the target month.
 * If input is "YYYY-MM", returns "YYYY-MM".
 * If input is "YYYY-MM-DD", returns "YYYY-MM-DD".
 */
export function addMonths(dateOrMonth: string, n: number): string {
  if (typeof dateOrMonth !== 'string') {
    throw new TypeError('Input must be a string');
  }
  if (!Number.isInteger(n)) {
    throw new TypeError('Month count n must be an integer');
  }

  const match = dateOrMonth.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) {
    throw new RangeError(`Invalid date or month format: "${dateOrMonth}"`);
  }

  const [, yStr, mStr, dStr] = match;
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) {
    throw new RangeError(`Invalid month: "${mStr}"`);
  }

  const totalZeroMonths = y * 12 + (m - 1) + n;
  const newY = Math.floor(totalZeroMonths / 12);
  const newM = ((totalZeroMonths % 12) + 12) % 12 + 1;
  const newYStr = String(newY).padStart(4, '0');
  const newMStr = String(newM).padStart(2, '0');

  if (dStr === undefined) {
    return `${newYStr}-${newMStr}`;
  }

  const d = parseInt(dStr, 10);
  const maxDays = getDaysInMonth(newY, newM);
  const clampedDay = Math.min(Math.max(1, d), maxDays);
  const newDStr = String(clampedDay).padStart(2, '0');

  return `${newYStr}-${newMStr}-${newDStr}`;
}

export interface MonthRange {
  start: string;
  end: string;
}

/**
 * Returns the inclusive start and end dates for a calendar month.
 * Accepts "YYYY-MM" or "YYYY-MM-DD" (e.g. "2024-02-01").
 */
export function monthRange(monthStart: string): MonthRange {
  if (typeof monthStart !== 'string') {
    throw new TypeError('Input must be a string');
  }
  const match = monthStart.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) {
    throw new RangeError(`Invalid month string: "${monthStart}"`);
  }

  const [, yStr, mStr] = match;
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) {
    throw new RangeError(`Invalid month: "${mStr}"`);
  }

  const days = getDaysInMonth(y, m);
  const start = `${yStr}-${mStr}-01`;
  const end = `${yStr}-${mStr}-${String(days).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Resolves natural relative words ("today", "yesterday") to a YYYY-MM-DD date.
 * Returns null for any unrecognized word.
 * Never uses timestamps or timezone offsets.
 */
export function resolveRelativeDate(
  word: string,
  today: string = todayLocal()
): string | null {
  if (typeof word !== 'string') {
    return null;
  }
  if (!isValidDateString(today)) {
    throw new RangeError(`Invalid today date string: "${today}"`);
  }

  const clean = word.trim().toLowerCase();
  if (clean === 'today') {
    return today;
  }
  if (clean === 'yesterday') {
    const [yStr, mStr, dStr] = today.split('-');
    const d = parseInt(dStr, 10);

    if (d > 1) {
      const prevD = String(d - 1).padStart(2, '0');
      return `${yStr}-${mStr}-${prevD}`;
    }

    // Step back to the last day of the previous calendar month
    const prevMonthStr = addMonths(`${yStr}-${mStr}`, -1);
    const [prevYStr, prevMStr] = prevMonthStr.split('-');
    const prevY = parseInt(prevYStr, 10);
    const prevM = parseInt(prevMStr, 10);
    const lastDay = getDaysInMonth(prevY, prevM);
    return `${prevYStr}-${prevMStr}-${String(lastDay).padStart(2, '0')}`;
  }

  return null;
}
