import { DbLike, TransactionRow, CategoryRow } from '../types';
import { emitTableChange } from '../events';
import {
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionFilters,
  PaginationOptions,
  RepositoryResult,
  WriteOptions,
} from './types';
import { generateClientUuid } from './uuid';
import { recordOutboxMutation, restoreOutboxMutation } from './outbox';
import {
  SERVER_PLACEHOLDER_VERSION,
  SERVER_PLACEHOLDER_CHANGE_SEQ,
  SERVER_PLACEHOLDER_TIMESTAMP,
} from './constants';
import { validateTransactionInput } from '../../lib/validation';
import { monthRange } from '../../lib/dates';

/**
 * Creates a financial transaction in SQLite and queues an outbox mutation atomically.
 *
 * Rules:
 * - Validates input using pure validateTransactionInput from src/lib/validation.ts.
 * - Verifies the referenced category exists locally, is NOT deleted, is NOT archived,
 *   and has a type compatible with the transaction (income vs expense).
 * - Row: assigns client UUID, local_revision = 1, sync_state = 'pending', server placeholders.
 * - Outbox: mutation_id = client UUID, op = 'create', base_version = null, payload with writable fields only.
 */
export async function createTransaction(
  db: DbLike,
  input: CreateTransactionInput,
  options?: WriteOptions
): Promise<RepositoryResult<TransactionRow>> {
  try {
    const valResult = validateTransactionInput(input);
    if (!valResult.ok) {
      return { ok: false, error: valResult.errors.join(', ') };
    }

    let createdTx: TransactionRow | null = null;

    await db.withTransactionAsync(async () => {
      // 1. Verify category rules locally
      const category = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [input.category_id]
      );

      if (!category || category.deleted_at !== null) {
        throw new Error('Category does not exist or has been deleted');
      }

      if (category.archived_at !== null) {
        throw new Error('Category is archived and cannot be used for transactions');
      }

      if (category.type !== input.type) {
        throw new Error(
          `Category type mismatch: category is '${category.type}' but transaction is '${input.type}'`
        );
      }

      const txId = generateClientUuid();
      const localRevision = 1;
      const note = input.note?.trim() || null;
      const recurringId = input.recurring_id ?? null;
      const occurrenceDate = input.occurrence_date ?? null;

      // Foreign key requires matching user_id between category and transaction
      const userId = category.user_id;

      // 2. Insert row into SQLite
      await db.runAsync(
        `INSERT INTO transactions (
          id, user_id, type, amount, category_id, note, date,
          recurring_id, occurrence_date, version, change_seq,
          created_at, updated_at, deleted_at, local_revision, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending');`,
        [
          txId,
          userId,
          input.type,
          input.amount,
          input.category_id,
          note,
          input.date,
          recurringId,
          occurrenceDate,
          SERVER_PLACEHOLDER_VERSION,
          SERVER_PLACEHOLDER_CHANGE_SEQ,
          SERVER_PLACEHOLDER_TIMESTAMP,
          SERVER_PLACEHOLDER_TIMESTAMP,
          localRevision,
        ]
      );

      // Simulation hook for atomicity testing
      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      // 3. Write outbox entry with ONLY writable fields accepted by apply_mutation
      const payload: Record<string, unknown> = {
        type: input.type,
        amount: input.amount,
        category_id: input.category_id,
        note,
        date: input.date,
        recurring_id: recurringId,
        occurrence_date: occurrenceDate,
      };

      await recordOutboxMutation(db, {
        tableName: 'transactions',
        entityId: txId,
        op: 'create',
        baseVersion: null,
        payload,
        localRevision,
      });

      createdTx = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE id = ?;',
        [txId]
      );
    });

    if (!createdTx) {
      return { ok: false, error: 'Failed to create transaction' };
    }

    emitTableChange(['transactions', 'outbox']);
    return { ok: true, value: createdTx };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Updates an existing transaction locally and coalesces the mutation in the outbox.
 */
export async function updateTransaction(
  db: DbLike,
  id: string,
  input: UpdateTransactionInput,
  options?: WriteOptions
): Promise<RepositoryResult<TransactionRow>> {
  try {
    let updatedTx: TransactionRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Transaction not found or deleted');
      }

      const merged = {
        type: input.type !== undefined ? input.type : existing.type,
        amount: input.amount !== undefined ? input.amount : existing.amount,
        category_id: input.category_id !== undefined ? input.category_id : existing.category_id,
        note: input.note !== undefined ? input.note : existing.note,
        date: input.date !== undefined ? input.date : existing.date,
        recurring_id:
          input.recurring_id !== undefined ? input.recurring_id : existing.recurring_id,
        occurrence_date:
          input.occurrence_date !== undefined ? input.occurrence_date : existing.occurrence_date,
      };

      const valResult = validateTransactionInput(merged);
      if (!valResult.ok) {
        throw new Error(valResult.errors.join(', '));
      }

      // If category or type changed, re-validate category rules
      if (merged.category_id !== existing.category_id || merged.type !== existing.type) {
        const category = await db.getFirstAsync<CategoryRow>(
          'SELECT * FROM categories WHERE id = ?;',
          [merged.category_id]
        );

        if (!category || category.deleted_at !== null) {
          throw new Error('Category does not exist or has been deleted');
        }

        // Only block archived category if category was explicitly changed
        if (merged.category_id !== existing.category_id && category.archived_at !== null) {
          throw new Error('Category is archived and cannot be selected for transaction');
        }

        if (category.type !== merged.type) {
          throw new Error(
            `Category type mismatch: category is '${category.type}' but transaction is '${merged.type}'`
          );
        }
      }

      const nextRev = existing.local_revision + 1;
      const note = merged.note?.trim() || null;

      await db.runAsync(
        `UPDATE transactions SET
          type = ?, amount = ?, category_id = ?, note = ?, date = ?,
          recurring_id = ?, occurrence_date = ?,
          local_revision = ?, sync_state = 'pending'
        WHERE id = ?;`,
        [
          merged.type,
          merged.amount,
          merged.category_id,
          note,
          merged.date,
          merged.recurring_id,
          merged.occurrence_date,
          nextRev,
          id,
        ]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const payload: Record<string, unknown> = {
        type: merged.type,
        amount: merged.amount,
        category_id: merged.category_id,
        note,
        date: merged.date,
        recurring_id: merged.recurring_id,
        occurrence_date: merged.occurrence_date,
      };

      await recordOutboxMutation(db, {
        tableName: 'transactions',
        entityId: id,
        op: 'update',
        baseVersion: existing.version,
        payload,
        localRevision: nextRev,
      });

      updatedTx = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE id = ?;',
        [id]
      );
    });

    if (!updatedTx) {
      return { ok: false, error: 'Failed to update transaction' };
    }

    emitTableChange(['transactions', 'outbox']);
    return { ok: true, value: updatedTx };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Soft-deletes a transaction with a 10-second undo window.
 */
export async function softDeleteTransaction(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<TransactionRow>> {
  try {
    let resultRow: TransactionRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Transaction not found or already deleted');
      }

      const nowIso = new Date().toISOString();
      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        "UPDATE transactions SET deleted_at = ?, local_revision = ?, sync_state = 'pending' WHERE id = ?;",
        [nowIso, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const outcome = await recordOutboxMutation(db, {
        tableName: 'transactions',
        entityId: id,
        op: 'delete',
        baseVersion: existing.version,
        payload: null,
        localRevision: nextRev,
      });

      if (outcome.rowDeletedLocally) {
        resultRow = { ...existing, deleted_at: nowIso };
      } else {
        const fresh = await db.getFirstAsync<TransactionRow>(
          'SELECT * FROM transactions WHERE id = ?;',
          [id]
        );
        resultRow = fresh ?? { ...existing, deleted_at: nowIso };
      }
    });

    if (!resultRow) {
      return { ok: false, error: 'Failed to delete transaction' };
    }

    emitTableChange(['transactions', 'outbox']);
    return { ok: true, value: resultRow };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Restores a soft-deleted transaction within the 10-second undo window.
 */
export async function restoreTransaction(
  db: DbLike,
  id: string
): Promise<RepositoryResult<TransactionRow>> {
  return restoreOutboxMutation<TransactionRow>(db, 'transactions', id);
}

/**
 * Retrieves a single transaction by ID (excluding soft-deleted rows).
 */
export async function getTransaction(db: DbLike, id: string): Promise<TransactionRow | null> {
  return db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL;',
    [id]
  );
}

/**
 * Lists transactions for a given calendar month (YYYY-MM or YYYY-MM-01).
 * Excludes soft-deleted rows. Sorted by date desc, then id desc.
 */
export async function listTransactionsForMonth(
  db: DbLike,
  monthStart: string
): Promise<TransactionRow[]> {
  const { start, end } = monthRange(monthStart);
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions
     WHERE date >= ? AND date <= ? AND deleted_at IS NULL
     ORDER BY date DESC, id DESC;`,
    [start, end]
  );
}

/**
 * Filters and paginates transactions.
 * Excludes soft-deleted rows. Sorted by date desc, then id desc.
 */
export async function listTransactionsFiltered(
  db: DbLike,
  filter: TransactionFilters,
  pagination?: PaginationOptions
): Promise<TransactionRow[]> {
  const conditions: string[] = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (filter.from) {
    conditions.push('date >= ?');
    params.push(filter.from);
  }

  if (filter.to) {
    conditions.push('date <= ?');
    params.push(filter.to);
  }

  if (filter.categoryId) {
    conditions.push('category_id = ?');
    params.push(filter.categoryId);
  }

  if (filter.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }

  if (filter.minAmount !== undefined) {
    conditions.push('amount >= ?');
    params.push(filter.minAmount);
  }

  if (filter.maxAmount !== undefined) {
    conditions.push('amount <= ?');
    params.push(filter.maxAmount);
  }

  if (filter.noteContains && filter.noteContains.trim().length > 0) {
    conditions.push("note LIKE '%' || ? || '%'");
    params.push(filter.noteContains.trim());
  }

  let sql = `SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC, id DESC`;

  if (pagination?.limit !== undefined && pagination.limit > 0) {
    sql += ' LIMIT ?';
    params.push(pagination.limit);

    if (pagination?.offset !== undefined && pagination.offset > 0) {
      sql += ' OFFSET ?';
      params.push(pagination.offset);
    }
  }

  return db.getAllAsync<TransactionRow>(sql, params);
}
