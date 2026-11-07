/**
 * Pure validation functions for Where Did It Go?
 * Follows PRD v4.0 Sections 5, 6, 7 and AGENTS.md rules.
 *
 * Plain synchronous functions without database or network access.
 * Returns { ok: true } or { ok: false, errors: [...] }.
 */

import { isValidDateString } from './dates';
import { MAX_AMOUNT } from './money';

export const MAX_NOTE_LENGTH = 500;
export const MAX_GOAL_NAME_LENGTH = 100;

export interface ValidationSuccess {
  ok: true;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface TransactionInput {
  amount?: unknown;
  type?: unknown;
  category_id?: unknown;
  categoryId?: unknown;
  date?: unknown;
  note?: unknown;
}

/**
 * Validates transaction creation or edit payload.
 *
 * Rules:
 * - amount: positive integer in minor units (1..MAX_AMOUNT).
 * - type: strictly 'income' or 'expense'.
 * - category_id: non-empty string.
 * - date: valid calendar date string (YYYY-MM-DD).
 * - note: optional string up to MAX_NOTE_LENGTH characters.
 */
export function validateTransactionInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['INPUT_NOT_OBJECT'] };
  }

  const tx = input as TransactionInput;

  // Validate amount (in minor units)
  if (
    typeof tx.amount !== 'number' ||
    !Number.isSafeInteger(tx.amount) ||
    tx.amount <= 0 ||
    tx.amount > MAX_AMOUNT
  ) {
    errors.push('INVALID_AMOUNT');
  }

  // Validate type
  if (tx.type !== 'income' && tx.type !== 'expense') {
    errors.push('INVALID_TYPE');
  }

  // Validate category_id (accepts category_id or categoryId)
  const categoryId = tx.category_id ?? tx.categoryId;
  if (typeof categoryId !== 'string' || categoryId.trim().length === 0) {
    errors.push('INVALID_CATEGORY');
  }

  // Validate date
  if (typeof tx.date !== 'string' || !isValidDateString(tx.date)) {
    errors.push('INVALID_DATE');
  }

  // Validate optional note
  if (tx.note !== undefined && tx.note !== null) {
    if (typeof tx.note !== 'string') {
      errors.push('INVALID_NOTE_TYPE');
    } else if (tx.note.length > MAX_NOTE_LENGTH) {
      errors.push('NOTE_TOO_LONG');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}

export interface GoalInput {
  month?: unknown;
  target_amount?: unknown;
  target?: unknown;
  name?: unknown;
}

/**
 * Validates a monthly savings goal payload.
 *
 * Rules:
 * - month: valid calendar date representing the first day of a month (YYYY-MM-01).
 * - target_amount: positive integer in minor units (1..MAX_AMOUNT).
 * - name: optional string up to MAX_GOAL_NAME_LENGTH characters.
 */
export function validateGoalInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['INPUT_NOT_OBJECT'] };
  }

  const goal = input as GoalInput;

  // Validate month (must be YYYY-MM-01 calendar date)
  if (
    typeof goal.month !== 'string' ||
    !isValidDateString(goal.month) ||
    !goal.month.endsWith('-01')
  ) {
    errors.push('INVALID_MONTH');
  }

  // Validate target_amount (or target)
  const target = goal.target_amount ?? goal.target;
  if (
    typeof target !== 'number' ||
    !Number.isSafeInteger(target) ||
    target <= 0 ||
    target > MAX_AMOUNT
  ) {
    errors.push('INVALID_TARGET_AMOUNT');
  }

  // Validate optional name
  if (goal.name !== undefined && goal.name !== null) {
    if (typeof goal.name !== 'string') {
      errors.push('INVALID_NAME_TYPE');
    } else if (goal.name.length > MAX_GOAL_NAME_LENGTH) {
      errors.push('NAME_TOO_LONG');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}

export interface BudgetInput {
  category_id?: unknown;
  categoryId?: unknown;
  monthly_limit?: unknown;
  limit?: unknown;
}

/**
 * Validates a category budget payload.
 *
 * Rules:
 * - category_id: non-empty string.
 * - monthly_limit: positive integer in minor units (1..MAX_AMOUNT).
 */
export function validateBudgetInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['INPUT_NOT_OBJECT'] };
  }

  const budget = input as BudgetInput;

  // Validate category_id (accepts category_id or categoryId)
  const categoryId = budget.category_id ?? budget.categoryId;
  if (typeof categoryId !== 'string' || categoryId.trim().length === 0) {
    errors.push('INVALID_CATEGORY');
  }

  // Validate monthly_limit (or limit)
  const limit = budget.monthly_limit ?? budget.limit;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_AMOUNT
  ) {
    errors.push('INVALID_LIMIT');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
