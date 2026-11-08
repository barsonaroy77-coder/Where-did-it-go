/**
 * Form helpers and validation for Add/Edit transaction screens.
 * Follows PRD v4.0 Sections 5 & 6 and AGENTS.md rules.
 */

import { CategoryRow, DbLike, TransactionType } from '@/db/types';
import { isValidDateString, resolveRelativeDate, todayLocal } from './dates';
import { parseAmountToMinorUnits } from './money';
import { MAX_NOTE_LENGTH } from './validation';

export const MIN_TRANSACTION_DATE = '2000-01-01';

/**
 * Queries SQLite for the category ID of the most recent non-deleted transaction of that type.
 */
export async function getMostRecentCategoryIdForType(
  db: DbLike,
  type: TransactionType
): Promise<string | null> {
  try {
    const row = await db.getFirstAsync<{ category_id: string }>(
      `SELECT category_id FROM transactions
       WHERE type = ? AND deleted_at IS NULL
       ORDER BY date DESC, id DESC
       LIMIT 1;`,
      [type]
    );
    return row?.category_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a date string is within the allowed range:
 * Between 2000-01-01 and the device's local today date (no future dates).
 */
export function isDateInRange(date: string, today: string = todayLocal()): boolean {
  if (!isValidDateString(date)) {
    return false;
  }
  return date >= MIN_TRANSACTION_DATE && date <= today;
}

/**
 * Quick date resolver for "today" and "yesterday" chips.
 */
export function getQuickDate(
  kind: 'today' | 'yesterday',
  today: string = todayLocal()
): string {
  if (kind === 'today') {
    return today;
  }
  const resolved = resolveRelativeDate('yesterday', today);
  return resolved ?? today;
}

/**
 * Chooses the default category:
 * The category used by the most recent transaction of that type if available and active,
 * else the first usable category of that type.
 */
export function chooseDefaultCategory(
  categories: readonly CategoryRow[],
  recentCategoryId?: string | null
): string | undefined {
  if (!categories || categories.length === 0) {
    return undefined;
  }
  if (recentCategoryId) {
    const found = categories.find((c) => c.id === recentCategoryId);
    if (found) {
      return found.id;
    }
  }
  return categories[0].id;
}

/**
 * Normalizes user-entered amount string before passing to parseAmountToMinorUnits.
 * For instance, a trailing decimal point "5." is trimmed to "5".
 */
export function cleanAmountInputForParse(amount: string): string {
  const trimmed = amount.trim();
  if (trimmed.endsWith('.')) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export interface TransactionFormErrors {
  amount?: string;
  category?: string;
  date?: string;
  note?: string;
}

export interface TransactionFormFields {
  amount: string;
  categoryId?: string | null;
  date: string;
  note?: string;
  decimals?: number;
}

export interface TransactionFormValidationResult {
  isValid: boolean;
  errors: TransactionFormErrors;
  amountMinor: number | null;
}

/**
 * Pure form validator with inline messages:
 * - "Enter an amount above 0"
 * - "Pick a category"
 * - "Pick a valid date"
 */
export function validateTransactionForm(
  fields: TransactionFormFields,
  today: string = todayLocal()
): TransactionFormValidationResult {
  const errors: TransactionFormErrors = {};
  const decimals = fields.decimals ?? 2;
  let amountMinor: number | null = null;

  // Validate amount
  const cleanedAmount = cleanAmountInputForParse(fields.amount);
  if (!cleanedAmount || cleanedAmount === '0') {
    errors.amount = 'Enter an amount above 0';
  } else {
    const parsed = parseAmountToMinorUnits(cleanedAmount, decimals);
    if (!parsed.ok || parsed.value <= 0) {
      errors.amount = 'Enter an amount above 0';
    } else {
      amountMinor = parsed.value;
    }
  }

  // Validate category
  if (!fields.categoryId || fields.categoryId.trim().length === 0) {
    errors.category = 'Pick a category';
  }

  // Validate date (2000-01-01 to today)
  if (!fields.date || !isDateInRange(fields.date, today)) {
    errors.date = 'Pick a valid date';
  }

  // Validate optional note
  if (fields.note !== undefined && fields.note !== null) {
    if (fields.note.length > MAX_NOTE_LENGTH) {
      errors.note = 'Note is too long';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    amountMinor,
  };
}
