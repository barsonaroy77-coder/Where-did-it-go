import {
  chooseDefaultCategory,
  isDateInRange,
  getQuickDate,
  validateTransactionForm,
  cleanAmountInputForParse,
  MIN_TRANSACTION_DATE,
} from '../transactionForm';
import { CategoryRow } from '@/db/types';

describe('transactionForm helpers and validation', () => {
  describe('chooseDefaultCategory', () => {
    const mockCategories: CategoryRow[] = [
      {
        id: 'cat-1',
        user_id: 'user-1',
        name: 'Food',
        icon: 'utensils',
        color: '#FF0000',
        type: 'expense',
        archived_at: null,
        version: 1,
        change_seq: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
        local_revision: 1,
        sync_state: 'synced',
      },
      {
        id: 'cat-2',
        user_id: 'user-1',
        name: 'Transport',
        icon: 'car',
        color: '#00FF00',
        type: 'expense',
        archived_at: null,
        version: 1,
        change_seq: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
        local_revision: 1,
        sync_state: 'synced',
      },
    ];

    it('returns undefined if categories list is empty', () => {
      expect(chooseDefaultCategory([])).toBeUndefined();
    });

    it('selects the category used by the most recent transaction if active in list', () => {
      expect(chooseDefaultCategory(mockCategories, 'cat-2')).toBe('cat-2');
    });

    it('falls back to the first category if recent category is not in active categories', () => {
      expect(chooseDefaultCategory(mockCategories, 'cat-deleted-or-archived')).toBe('cat-1');
    });

    it('falls back to the first category if no recent transaction category exists', () => {
      expect(chooseDefaultCategory(mockCategories, null)).toBe('cat-1');
      expect(chooseDefaultCategory(mockCategories, undefined)).toBe('cat-1');
    });
  });

  describe('isDateInRange (Allowed range: 2000-01-01 to today)', () => {
    const today = '2026-11-08';

    it('accepts MIN_TRANSACTION_DATE (2000-01-01)', () => {
      expect(MIN_TRANSACTION_DATE).toBe('2000-01-01');
      expect(isDateInRange(MIN_TRANSACTION_DATE, today)).toBe(true);
    });

    it('accepts today', () => {
      expect(isDateInRange(today, today)).toBe(true);
    });

    it('accepts dates between 2000-01-01 and today', () => {
      expect(isDateInRange('2024-02-29', today)).toBe(true);
      expect(isDateInRange('2015-06-15', today)).toBe(true);
      expect(isDateInRange('2026-11-07', today)).toBe(true);
    });

    it('rejects dates before 2000-01-01', () => {
      expect(isDateInRange('1999-12-31', today)).toBe(false);
      expect(isDateInRange('1985-05-20', today)).toBe(false);
    });

    it('rejects future dates (no future dates allowed)', () => {
      expect(isDateInRange('2026-11-09', today)).toBe(false);
      expect(isDateInRange('2027-01-01', today)).toBe(false);
    });

    it('rejects invalid date strings', () => {
      expect(isDateInRange('invalid', today)).toBe(false);
      expect(isDateInRange('2026-02-30', today)).toBe(false);
      expect(isDateInRange('2025-02-29', today)).toBe(false); // Non-leap year
      expect(isDateInRange('', today)).toBe(false);
    });
  });

  describe('getQuickDate helpers', () => {
    it('returns today for "today"', () => {
      const today = '2026-11-08';
      expect(getQuickDate('today', today)).toBe('2026-11-08');
    });

    it('returns yesterday for "yesterday"', () => {
      const today = '2026-11-08';
      expect(getQuickDate('yesterday', today)).toBe('2026-11-07');
    });

    it('correctly transitions across month boundaries for yesterday', () => {
      expect(getQuickDate('yesterday', '2026-03-01')).toBe('2026-02-28');
      expect(getQuickDate('yesterday', '2024-03-01')).toBe('2024-02-29'); // Leap year
      expect(getQuickDate('yesterday', '2026-01-01')).toBe('2025-12-31'); // Year boundary
    });
  });

  describe('cleanAmountInputForParse', () => {
    it('strips trailing decimal point', () => {
      expect(cleanAmountInputForParse('5.')).toBe('5');
      expect(cleanAmountInputForParse('42.50')).toBe('42.50');
      expect(cleanAmountInputForParse('   10.   ')).toBe('10');
    });
  });

  describe('validateTransactionForm (inline messages & rules)', () => {
    const today = '2026-11-08';

    it('validates a completely valid transaction', () => {
      const result = validateTransactionForm(
        {
          amount: '42.50',
          categoryId: 'cat-1',
          date: '2026-11-08',
          note: 'Groceries',
          decimals: 2,
        },
        today
      );

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
      expect(result.amountMinor).toBe(4250);
    });

    it('handles trailing dot on amount gracefully by normalizing it', () => {
      const result = validateTransactionForm(
        {
          amount: '5.',
          categoryId: 'cat-1',
          date: '2026-11-08',
          decimals: 2,
        },
        today
      );

      expect(result.isValid).toBe(true);
      expect(result.amountMinor).toBe(500);
    });

    it('returns "Enter an amount above 0" for empty or zero amounts', () => {
      expect(
        validateTransactionForm({ amount: '', categoryId: 'cat-1', date: today }, today)
          .errors.amount
      ).toBe('Enter an amount above 0');

      expect(
        validateTransactionForm({ amount: '0', categoryId: 'cat-1', date: today }, today)
          .errors.amount
      ).toBe('Enter an amount above 0');

      expect(
        validateTransactionForm({ amount: '0.00', categoryId: 'cat-1', date: today }, today)
          .errors.amount
      ).toBe('Enter an amount above 0');
    });

    it('returns "Pick a category" when category is missing or empty', () => {
      expect(
        validateTransactionForm({ amount: '10', categoryId: undefined, date: today }, today)
          .errors.category
      ).toBe('Pick a category');

      expect(
        validateTransactionForm({ amount: '10', categoryId: '', date: today }, today)
          .errors.category
      ).toBe('Pick a category');

      expect(
        validateTransactionForm({ amount: '10', categoryId: '   ', date: today }, today)
          .errors.category
      ).toBe('Pick a category');
    });

    it('returns "Pick a valid date" when date is invalid or in future', () => {
      expect(
        validateTransactionForm({ amount: '10', categoryId: 'cat-1', date: '2026-11-09' }, today)
          .errors.date
      ).toBe('Pick a valid date');

      expect(
        validateTransactionForm({ amount: '10', categoryId: 'cat-1', date: '1999-12-31' }, today)
          .errors.date
      ).toBe('Pick a valid date');

      expect(
        validateTransactionForm({ amount: '10', categoryId: 'cat-1', date: 'invalid' }, today)
          .errors.date
      ).toBe('Pick a valid date');
    });

    it('returns "Note is too long" when note exceeds MAX_NOTE_LENGTH (500)', () => {
      const longNote = 'a'.repeat(501);
      const result = validateTransactionForm(
        { amount: '10', categoryId: 'cat-1', date: today, note: longNote },
        today
      );
      expect(result.errors.note).toBe('Note is too long');
      expect(result.isValid).toBe(false);
    });

    it('collects multiple errors at once', () => {
      const result = validateTransactionForm(
        { amount: '', categoryId: undefined, date: '2099-01-01' },
        today
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.amount).toBe('Enter an amount above 0');
      expect(result.errors.category).toBe('Pick a category');
      expect(result.errors.date).toBe('Pick a valid date');
    });
  });
});
