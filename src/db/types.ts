/**
 * Database types and schema definitions for Where Did It Go?
 * Covers the 6 synced mirror tables and local metadata tables.
 */

/**
 * Six synchronized entity table names listed in strict dependency order:
 * categories precedes budgets, recurring, and transactions.
 * recurring precedes transactions.
 */
export const TABLE_NAMES = [
  'categories',
  'profiles',
  'goals',
  'budgets',
  'recurring',
  'transactions',
] as const;

export type SyncedTableName = (typeof TABLE_NAMES)[number];

export type SyncState = 'synced' | 'pending' | 'conflict';
export type MutationOp = 'create' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'blocked';
export type ConflictResolution = 'keep_mine' | 'use_server';
export type TransactionType = 'income' | 'expense';

export type RecurringFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'bi-weekly'
  | 'monthly'
  | 'yearly'
  | 'annually';

// -----------------------------------------------------------------------------
// 1. Mirror Table Row Types
// -----------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  currency: string;
  currency_decimals: number;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  local_revision: number;
  sync_state: SyncState;
}

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  archived_at: string | null;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  sync_state: SyncState;
}

export interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string;
  monthly_limit: number;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  sync_state: SyncState;
}

export interface RecurringRow {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  category_id: string;
  note: string | null;
  frequency: RecurringFrequency;
  start_date: string;
  next_date: string;
  schedule_timezone: string;
  anchor_day: number;
  is_active: number; // 0 | 1
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  sync_state: SyncState;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  category_id: string;
  note: string | null;
  date: string;
  recurring_id: string | null;
  occurrence_date: string | null;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  sync_state: SyncState;
}

export interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  month: string;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  sync_state: SyncState;
}

// -----------------------------------------------------------------------------
// 2. Local-Only Metadata Table Row Types
// -----------------------------------------------------------------------------

export interface OutboxRow {
  sequence: number;
  mutation_id: string;
  table_name: string;
  entity_id: string;
  op: MutationOp;
  base_version: number | null;
  payload: string | null;
  local_revision: number;
  status: OutboxStatus;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface SyncStateMetaRow {
  table_name: string;
  last_change_seq: number;
  updated_at: string;
}

export interface SyncErrorRow {
  id: number;
  mutation_id: string;
  table_name: string;
  entity_id: string;
  code: string;
  message: string;
  created_at: string;
}

export interface ConflictRow {
  id: number;
  mutation_id: string;
  table_name: string;
  entity_id: string;
  local_payload: string;
  server_row: string;
  created_at: string;
  resolved_at: string | null;
  resolution: ConflictResolution | null;
}

export interface AppMetaRow {
  key: string;
  value: string | null;
}
