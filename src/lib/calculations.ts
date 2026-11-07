/**
 * Pure financial calculations for Where Did It Go?
 * Follows PRD v4.0 Sections 5.3, 6.3, 6.4, 6.6 and AGENTS.md rules.
 *
 * All financial amounts are integer minor units (cents/paise).
 * Pure functions over plain arrays without database or network access.
 */

import { monthRange, monthKey, todayLocal } from './dates';
import { addMoney, formatMinorUnits } from './money';

export interface TransactionLike {
  amount: number;
  type: 'income' | 'expense';
  date: string;
  deleted_at?: string | null;
}

export interface MonthlySummary {
  income: number;
  spent: number;
  saved: number; // Income - Spent; can be negative
  transactionCount: number;
}

/**
 * Calculates monthly summary for a given calendar month:
 * Income = sum(non-deleted income transactions)
 * Spent = sum(non-deleted expense transactions)
 * Saved = Income - Spent (can be negative)
 *
 * Uses transaction dates, strictly excluding soft-deleted rows (deleted_at != null).
 * Transactions on the first or last day of the calendar month are included.
 */
export function monthlySummary(
  transactions: readonly TransactionLike[],
  monthStart: string
): MonthlySummary {
  const range = monthRange(monthStart);

  let income = 0;
  let spent = 0;
  let transactionCount = 0;

  for (const t of transactions) {
    if (t.deleted_at != null && t.deleted_at !== '') {
      continue;
    }
    if (t.date >= range.start && t.date <= range.end) {
      if (t.type === 'income') {
        income = addMoney(income, t.amount);
        transactionCount++;
      } else if (t.type === 'expense') {
        spent = addMoney(spent, t.amount);
        transactionCount++;
      }
    }
  }

  const saved = income - spent;
  return { income, spent, saved, transactionCount };
}

/**
 * Returns the exact display message "Spent X more than earned." when saved < 0.
 * In accordance with PRD v4.0 Section 5.3 and AGENTS.md rules, this NEVER uses the word "debt".
 * Returns null if saved >= 0.
 */
export function getDeficitDisplayMessage(
  saved: number,
  decimals: number = 2,
  currencySymbol: string = ''
): string | null {
  if (saved >= 0) {
    return null;
  }
  const absAmount = Math.abs(saved);
  const formatted = formatMinorUnits(absAmount, decimals);
  const amountStr = currencySymbol ? `${currencySymbol}${formatted}` : formatted;
  return `Spent ${amountStr} more than earned.`;
}

export interface GoalProgressResult {
  progress: number; // Clamped to 0..1 for UI progress bar
  savedAmount: number; // Raw saved amount (can be negative or > target)
  isCompleted: boolean;
}

/**
 * Calculates goal progress (PRD v4.0 Section 6.3):
 * Progress = max(0, Monthly Saved) / Target Amount, clamped to 0..1.
 * Also returns raw savedAmount (which may be negative or above target).
 */
export function goalProgress(
  monthlySaved: number,
  targetAmount: number
): GoalProgressResult {
  if (targetAmount <= 0) {
    return {
      progress: 0,
      savedAmount: monthlySaved,
      isCompleted: false,
    };
  }
  const rawProgress = Math.max(0, monthlySaved) / targetAmount;
  const clampedProgress = Math.min(1, Math.max(0, rawProgress));
  return {
    progress: clampedProgress,
    savedAmount: monthlySaved,
    isCompleted: monthlySaved >= targetAmount,
  };
}

export type BudgetHealth = 'ok' | 'warning' | 'over';

export interface BudgetStatusResult {
  status: BudgetHealth;
  spent: number;
  limit: number;
  percent: number;
  exceededAmount: number;
}

/**
 * Evaluates budget status against spending (PRD v4.0 Section 6.4):
 * - Warns at >= 80% ("warning")
 * - Over at >= 100% ("over")
 * - Otherwise "ok"
 * Above the limit, returns the exact exceededAmount (spent - limit).
 */
export function budgetStatus(
  spent: number,
  limit: number
): BudgetStatusResult {
  if (limit <= 0) {
    return {
      status: 'over',
      spent,
      limit,
      percent: 100,
      exceededAmount: spent > 0 ? spent : 0,
    };
  }

  const ratio = spent / limit;
  const percent = ratio * 100;

  let status: BudgetHealth;
  if (ratio >= 1) {
    status = 'over';
  } else if (ratio >= 0.8) {
    status = 'warning';
  } else {
    status = 'ok';
  }

  const exceededAmount = spent > limit ? spent - limit : 0;

  return {
    status,
    spent,
    limit,
    percent,
    exceededAmount,
  };
}

/**
 * Calculates spending change percentage between current and previous month (PRD v4.0 Section 6.6):
 * Change % = [(Current Spending - Previous Spending) / Previous Spending] * 100
 *
 * When previous spending is 0, percentage change is mathematically undefined.
 * It returns null (never Infinity or NaN).
 */
export function changePercent(
  current: number,
  previous: number
): number | null {
  if (previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * Helper to determine if a given date or month string represents the ongoing
 * current month ("month to date" label per PRD v4.0 Section 6.6).
 */
export function isMonthToDate(
  dateOrMonth: string,
  today: string = todayLocal()
): boolean {
  return monthKey(dateOrMonth) === monthKey(today);
}
