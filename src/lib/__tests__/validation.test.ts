import {
  validateTransactionInput,
  validateGoalInput,
  validateBudgetInput,
  MAX_NOTE_LENGTH,
  MAX_GOAL_NAME_LENGTH,
} from '../validation';
import { MAX_AMOUNT } from '../money';

describe('validation.ts', () => {
  describe('validateTransactionInput', () => {
    const validTx = {
      amount: 450,
      type: 'expense',
      category_id: 'cat-groceries',
      date: '2026-11-07',
      note: 'Milk and bread',
    };

    it('accepts valid transaction input', () => {
      expect(validateTransactionInput(validTx)).toEqual({ ok: true });
      expect(
        validateTransactionInput({
          ...validTx,
          type: 'income',
          note: undefined,
          categoryId: 'cat-salary', // camelCase alias
        })
      ).toEqual({ ok: true });
      expect(
        validateTransactionInput({
          ...validTx,
          note: null,
        })
      ).toEqual({ ok: true });
    });

    it('rejects non-object inputs', () => {
      expect(validateTransactionInput(null)).toEqual({
        ok: false,
        errors: ['INPUT_NOT_OBJECT'],
      });
      expect(validateTransactionInput('invalid')).toEqual({
        ok: false,
        errors: ['INPUT_NOT_OBJECT'],
      });
    });

    it('rejects invalid amounts (<= 0, non-integer, > MAX_AMOUNT, non-number)', () => {
      expect(validateTransactionInput({ ...validTx, amount: 0 })).toEqual({
        ok: false,
        errors: ['INVALID_AMOUNT'],
      });
      expect(validateTransactionInput({ ...validTx, amount: -500 })).toEqual({
        ok: false,
        errors: ['INVALID_AMOUNT'],
      });
      expect(validateTransactionInput({ ...validTx, amount: 4.5 })).toEqual({
        ok: false,
        errors: ['INVALID_AMOUNT'],
      });
      expect(validateTransactionInput({ ...validTx, amount: MAX_AMOUNT + 1 })).toEqual({
        ok: false,
        errors: ['INVALID_AMOUNT'],
      });
      expect(validateTransactionInput({ ...validTx, amount: '450' })).toEqual({
        ok: false,
        errors: ['INVALID_AMOUNT'],
      });
    });

    it('rejects invalid transaction types', () => {
      expect(validateTransactionInput({ ...validTx, type: 'transfer' })).toEqual({
        ok: false,
        errors: ['INVALID_TYPE'],
      });
      expect(validateTransactionInput({ ...validTx, type: '' })).toEqual({
        ok: false,
        errors: ['INVALID_TYPE'],
      });
    });

    it('rejects invalid category_id (empty, missing, or non-string)', () => {
      expect(validateTransactionInput({ ...validTx, category_id: '' })).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
      expect(validateTransactionInput({ ...validTx, category_id: '   ' })).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
      expect(
        validateTransactionInput({ ...validTx, category_id: undefined, categoryId: undefined })
      ).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
      expect(validateTransactionInput({ ...validTx, category_id: 123 })).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
    });

    it('rejects invalid date strings (bad format, non-leap year, non-calendar)', () => {
      expect(validateTransactionInput({ ...validTx, date: '2026-1-1' })).toEqual({
        ok: false,
        errors: ['INVALID_DATE'],
      });
      expect(validateTransactionInput({ ...validTx, date: '2025-02-29' })).toEqual({
        ok: false,
        errors: ['INVALID_DATE'],
      });
      expect(validateTransactionInput({ ...validTx, date: 20261107 })).toEqual({
        ok: false,
        errors: ['INVALID_DATE'],
      });
    });

    it('rejects invalid notes (non-string or exceeding MAX_NOTE_LENGTH)', () => {
      expect(validateTransactionInput({ ...validTx, note: 12345 })).toEqual({
        ok: false,
        errors: ['INVALID_NOTE_TYPE'],
      });
      const longNote = 'a'.repeat(MAX_NOTE_LENGTH + 1);
      expect(validateTransactionInput({ ...validTx, note: longNote })).toEqual({
        ok: false,
        errors: ['NOTE_TOO_LONG'],
      });
    });

    it('accumulates multiple validation errors', () => {
      const res = validateTransactionInput({
        amount: -10,
        type: 'invalid',
        category_id: '',
        date: 'bad-date',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors).toContain('INVALID_AMOUNT');
        expect(res.errors).toContain('INVALID_TYPE');
        expect(res.errors).toContain('INVALID_CATEGORY');
        expect(res.errors).toContain('INVALID_DATE');
      }
    });
  });

  describe('validateGoalInput', () => {
    const validGoal = {
      month: '2026-11-01',
      target_amount: 50000,
      name: 'Emergency Fund',
    };

    it('accepts valid goal input', () => {
      expect(validateGoalInput(validGoal)).toEqual({ ok: true });
      expect(
        validateGoalInput({
          month: '2026-12-01',
          target: 10000, // target alias
        })
      ).toEqual({ ok: true });
    });

    it('rejects non-object inputs', () => {
      expect(validateGoalInput(null)).toEqual({
        ok: false,
        errors: ['INPUT_NOT_OBJECT'],
      });
    });

    it('rejects months that are not the first day of a valid calendar month', () => {
      // Mid-month
      expect(validateGoalInput({ ...validGoal, month: '2026-11-15' })).toEqual({
        ok: false,
        errors: ['INVALID_MONTH'],
      });
      // Malformed date
      expect(validateGoalInput({ ...validGoal, month: '2026-13-01' })).toEqual({
        ok: false,
        errors: ['INVALID_MONTH'],
      });
      expect(validateGoalInput({ ...validGoal, month: '2026-11' })).toEqual({
        ok: false,
        errors: ['INVALID_MONTH'],
      });
    });

    it('rejects invalid target amounts', () => {
      expect(validateGoalInput({ ...validGoal, target_amount: 0 })).toEqual({
        ok: false,
        errors: ['INVALID_TARGET_AMOUNT'],
      });
      expect(validateGoalInput({ ...validGoal, target_amount: -100 })).toEqual({
        ok: false,
        errors: ['INVALID_TARGET_AMOUNT'],
      });
      expect(validateGoalInput({ ...validGoal, target_amount: 50.5 })).toEqual({
        ok: false,
        errors: ['INVALID_TARGET_AMOUNT'],
      });
      expect(validateGoalInput({ ...validGoal, target_amount: MAX_AMOUNT + 1 })).toEqual({
        ok: false,
        errors: ['INVALID_TARGET_AMOUNT'],
      });
    });

    it('rejects invalid goal names', () => {
      expect(validateGoalInput({ ...validGoal, name: 12345 })).toEqual({
        ok: false,
        errors: ['INVALID_NAME_TYPE'],
      });
      const longName = 'g'.repeat(MAX_GOAL_NAME_LENGTH + 1);
      expect(validateGoalInput({ ...validGoal, name: longName })).toEqual({
        ok: false,
        errors: ['NAME_TOO_LONG'],
      });
    });
  });

  describe('validateBudgetInput', () => {
    const validBudget = {
      category_id: 'cat-groceries',
      monthly_limit: 40000,
    };

    it('accepts valid budget input', () => {
      expect(validateBudgetInput(validBudget)).toEqual({ ok: true });
      expect(
        validateBudgetInput({
          categoryId: 'cat-dining',
          limit: 15000,
        })
      ).toEqual({ ok: true });
    });

    it('rejects non-object inputs', () => {
      expect(validateBudgetInput(undefined)).toEqual({
        ok: false,
        errors: ['INPUT_NOT_OBJECT'],
      });
    });

    it('rejects empty or missing category_id', () => {
      expect(validateBudgetInput({ ...validBudget, category_id: '' })).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
      expect(validateBudgetInput({ ...validBudget, category_id: '  ' })).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
      expect(
        validateBudgetInput({ ...validBudget, category_id: undefined, categoryId: undefined })
      ).toEqual({
        ok: false,
        errors: ['INVALID_CATEGORY'],
      });
    });

    it('rejects invalid monthly limit (<= 0, non-integer, > MAX_AMOUNT, non-number)', () => {
      expect(validateBudgetInput({ ...validBudget, monthly_limit: 0 })).toEqual({
        ok: false,
        errors: ['INVALID_LIMIT'],
      });
      expect(validateBudgetInput({ ...validBudget, monthly_limit: -500 })).toEqual({
        ok: false,
        errors: ['INVALID_LIMIT'],
      });
      expect(validateBudgetInput({ ...validBudget, monthly_limit: 100.5 })).toEqual({
        ok: false,
        errors: ['INVALID_LIMIT'],
      });
      expect(validateBudgetInput({ ...validBudget, monthly_limit: MAX_AMOUNT + 1 })).toEqual({
        ok: false,
        errors: ['INVALID_LIMIT'],
      });
      expect(validateBudgetInput({ ...validBudget, monthly_limit: '40000' })).toEqual({
        ok: false,
        errors: ['INVALID_LIMIT'],
      });
    });
  });
});
