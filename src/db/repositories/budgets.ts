import { DbLike, BudgetRow, CategoryRow } from '../types';
import { emitTableChange } from '../events';
import {
  CreateBudgetInput,
  UpdateBudgetInput,
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
import { validateBudgetInput } from '../../lib/validation';

/**
 * Creates a category budget in SQLite and queues an outbox mutation atomically.
 *
 * Rules:
 * - Validates input using pure validateBudgetInput.
 * - Category must exist locally and NOT be deleted.
 * - Category must NOT be archived.
 * - Category type must be 'expense' (budgets are allowed ONLY for expense categories).
 * - Enforces single active budget per category constraint locally.
 * - Row: assigns client UUID, local_revision = 1, sync_state = 'pending', server placeholders.
 * - Outbox: mutation_id = client UUID, op = 'create', base_version = null, payload with writable fields only.
 */
export async function createBudget(
  db: DbLike,
  input: CreateBudgetInput,
  options?: WriteOptions
): Promise<RepositoryResult<BudgetRow>> {
  try {
    const valResult = validateBudgetInput(input);
    if (!valResult.ok) {
      return { ok: false, error: valResult.errors.join(', ') };
    }

    let createdBudget: BudgetRow | null = null;

    await db.withTransactionAsync(async () => {
      // 1. Validate category existence and expense type
      const category = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [input.category_id]
      );

      if (!category || category.deleted_at !== null) {
        throw new Error('Category does not exist or has been deleted');
      }

      if (category.archived_at !== null) {
        throw new Error('Cannot create budget for archived category');
      }

      if (category.type !== 'expense') {
        throw new Error('Budgets can only be created for expense categories');
      }

      // 2. Enforce one active budget per category rule
      const existingActive = await db.getFirstAsync<BudgetRow>(
        'SELECT id FROM budgets WHERE category_id = ? AND deleted_at IS NULL;',
        [input.category_id]
      );

      if (existingActive) {
        throw new Error('An active budget already exists for this category');
      }

      const budgetId = generateClientUuid();
      const localRevision = 1;
      const userId = category.user_id;

      // 3. Write row to SQLite
      await db.runAsync(
        `INSERT INTO budgets (
          id, user_id, category_id, monthly_limit,
          version, change_seq, created_at, updated_at, deleted_at,
          local_revision, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending');`,
        [
          budgetId,
          userId,
          input.category_id,
          input.monthly_limit,
          SERVER_PLACEHOLDER_VERSION,
          SERVER_PLACEHOLDER_CHANGE_SEQ,
          SERVER_PLACEHOLDER_TIMESTAMP,
          SERVER_PLACEHOLDER_TIMESTAMP,
          localRevision,
        ]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      // 4. Outbox mutation with ONLY writable fields accepted by apply_mutation
      const payload: Record<string, unknown> = {
        category_id: input.category_id,
        monthly_limit: input.monthly_limit,
      };

      await recordOutboxMutation(db, {
        tableName: 'budgets',
        entityId: budgetId,
        op: 'create',
        baseVersion: null,
        payload,
        localRevision,
      });

      createdBudget = await db.getFirstAsync<BudgetRow>(
        'SELECT * FROM budgets WHERE id = ?;',
        [budgetId]
      );
    });

    if (!createdBudget) {
      return { ok: false, error: 'Failed to create budget' };
    }

    emitTableChange(['budgets', 'outbox']);
    return { ok: true, value: createdBudget };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Updates an existing category budget locally and coalesces the mutation in the outbox.
 */
export async function updateBudget(
  db: DbLike,
  id: string,
  input: UpdateBudgetInput,
  options?: WriteOptions
): Promise<RepositoryResult<BudgetRow>> {
  try {
    let updatedBudget: BudgetRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<BudgetRow>(
        'SELECT * FROM budgets WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Budget not found or deleted');
      }

      const merged = {
        category_id: input.category_id !== undefined ? input.category_id : existing.category_id,
        monthly_limit:
          input.monthly_limit !== undefined ? input.monthly_limit : existing.monthly_limit,
      };

      const valResult = validateBudgetInput(merged);
      if (!valResult.ok) {
        throw new Error(valResult.errors.join(', '));
      }

      if (merged.category_id !== existing.category_id) {
        const category = await db.getFirstAsync<CategoryRow>(
          'SELECT * FROM categories WHERE id = ?;',
          [merged.category_id]
        );

        if (!category || category.deleted_at !== null) {
          throw new Error('Category does not exist or has been deleted');
        }

        if (category.archived_at !== null) {
          throw new Error('Cannot reassign budget to archived category');
        }

        if (category.type !== 'expense') {
          throw new Error('Budgets can only be created for expense categories');
        }

        const duplicateCheck = await db.getFirstAsync<BudgetRow>(
          'SELECT id FROM budgets WHERE category_id = ? AND id != ? AND deleted_at IS NULL;',
          [merged.category_id, id]
        );

        if (duplicateCheck) {
          throw new Error('An active budget already exists for this category');
        }
      }

      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        `UPDATE budgets SET
          category_id = ?, monthly_limit = ?,
          local_revision = ?, sync_state = 'pending'
        WHERE id = ?;`,
        [merged.category_id, merged.monthly_limit, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const payload: Record<string, unknown> = {
        category_id: merged.category_id,
        monthly_limit: merged.monthly_limit,
      };

      await recordOutboxMutation(db, {
        tableName: 'budgets',
        entityId: id,
        op: 'update',
        baseVersion: existing.version,
        payload,
        localRevision: nextRev,
      });

      updatedBudget = await db.getFirstAsync<BudgetRow>(
        'SELECT * FROM budgets WHERE id = ?;',
        [id]
      );
    });

    if (!updatedBudget) {
      return { ok: false, error: 'Failed to update budget' };
    }

    return { ok: true, value: updatedBudget };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Soft-deletes a category budget with a 10-second undo window.
 */
export async function softDeleteBudget(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<BudgetRow>> {
  try {
    let resultRow: BudgetRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<BudgetRow>(
        'SELECT * FROM budgets WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Budget not found or already deleted');
      }

      const nowIso = new Date().toISOString();
      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        "UPDATE budgets SET deleted_at = ?, local_revision = ?, sync_state = 'pending' WHERE id = ?;",
        [nowIso, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const outcome = await recordOutboxMutation(db, {
        tableName: 'budgets',
        entityId: id,
        op: 'delete',
        baseVersion: existing.version,
        payload: null,
        localRevision: nextRev,
      });

      if (outcome.rowDeletedLocally) {
        resultRow = { ...existing, deleted_at: nowIso };
      } else {
        const fresh = await db.getFirstAsync<BudgetRow>(
          'SELECT * FROM budgets WHERE id = ?;',
          [id]
        );
        resultRow = fresh ?? { ...existing, deleted_at: nowIso };
      }
    });

    if (!resultRow) {
      return { ok: false, error: 'Failed to delete budget' };
    }

    emitTableChange(['budgets', 'outbox']);
    return { ok: true, value: resultRow };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Restores a soft-deleted budget within the 10-second undo window.
 */
export async function restoreBudget(
  db: DbLike,
  id: string
): Promise<RepositoryResult<BudgetRow>> {
  return restoreOutboxMutation<BudgetRow>(db, 'budgets', id);
}

/**
 * Retrieves a single budget by ID (excluding soft-deleted rows).
 */
export async function getBudget(db: DbLike, id: string): Promise<BudgetRow | null> {
  return db.getFirstAsync<BudgetRow>(
    'SELECT * FROM budgets WHERE id = ? AND deleted_at IS NULL;',
    [id]
  );
}

/**
 * Retrieves the active budget for a specific category (excluding soft-deleted rows).
 */
export async function getBudgetForCategory(
  db: DbLike,
  categoryId: string
): Promise<BudgetRow | null> {
  return db.getFirstAsync<BudgetRow>(
    'SELECT * FROM budgets WHERE category_id = ? AND deleted_at IS NULL LIMIT 1;',
    [categoryId]
  );
}

/**
 * Lists all active budgets (excluding soft-deleted rows).
 */
export async function listBudgets(db: DbLike): Promise<BudgetRow[]> {
  return db.getAllAsync<BudgetRow>(
    'SELECT * FROM budgets WHERE deleted_at IS NULL ORDER BY created_at ASC;'
  );
}
