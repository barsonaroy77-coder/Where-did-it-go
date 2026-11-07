import {
  TransactionType,
  RecurringFrequency,
} from '../types';

export type RepositorySuccess<T> = { ok: true; value: T };
export type RepositoryFailure = { ok: false; error: string };
export type RepositoryResult<T> = RepositorySuccess<T> | RepositoryFailure;

export interface WriteOptions {
  userId?: string;
  /** Internal test hook: forces an exception immediately following row write to test transaction rollback. */
  _simulateFailureAfterRowWrite?: boolean;
}

// -----------------------------------------------------------------------------
// Category Types
// -----------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  archived_at?: string | null;
  userId?: string;
  user_id?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  type?: TransactionType;
  archived_at?: string | null;
}

// -----------------------------------------------------------------------------
// Transaction Types
// -----------------------------------------------------------------------------

export interface CreateTransactionInput {
  type: TransactionType;
  amount: number;
  category_id: string;
  note?: string | null;
  date: string;
  recurring_id?: string | null;
  occurrence_date?: string | null;
  userId?: string;
  user_id?: string;
}

export interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  category_id?: string;
  note?: string | null;
  date?: string;
  recurring_id?: string | null;
  occurrence_date?: string | null;
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  type?: TransactionType;
  minAmount?: number;
  maxAmount?: number;
  noteContains?: string;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

// -----------------------------------------------------------------------------
// Goal Types
// -----------------------------------------------------------------------------

export interface CreateGoalInput {
  name: string;
  target_amount: number;
  month: string; // Must be YYYY-MM-01
  userId?: string;
  user_id?: string;
}

export interface UpdateGoalInput {
  name?: string;
  target_amount?: number;
  month?: string;
}

// -----------------------------------------------------------------------------
// Budget Types
// -----------------------------------------------------------------------------

export interface CreateBudgetInput {
  category_id: string;
  monthly_limit: number;
  userId?: string;
  user_id?: string;
}

export interface UpdateBudgetInput {
  category_id?: string;
  monthly_limit?: number;
}

// -----------------------------------------------------------------------------
// Recurring Types
// -----------------------------------------------------------------------------

export interface CreateRecurringInput {
  type: TransactionType;
  amount: number;
  category_id: string;
  note?: string | null;
  frequency: RecurringFrequency;
  start_date: string;
  next_date: string;
  schedule_timezone: string;
  anchor_day: number;
  is_active?: boolean | number;
  userId?: string;
  user_id?: string;
}

export interface UpdateRecurringInput {
  type?: TransactionType;
  amount?: number;
  category_id?: string;
  note?: string | null;
  frequency?: RecurringFrequency;
  start_date?: string;
  next_date?: string;
  schedule_timezone?: string;
  anchor_day?: number;
  is_active?: boolean | number;
}

// -----------------------------------------------------------------------------
// Profile Types (Read-only local cache)
// -----------------------------------------------------------------------------

export interface ServerProfileInput {
  id: string;
  currency: string;
  currency_decimals: number;
  version?: number;
  change_seq?: number;
  created_at: string;
  updated_at: string;
}
