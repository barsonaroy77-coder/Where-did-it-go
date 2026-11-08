import { DbLike, CategoryRow } from '../types';
import { emitTableChange } from '../events';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  RepositoryResult,
  WriteOptions,
} from './types';
import { generateClientUuid } from './uuid';
import { recordOutboxMutation, restoreOutboxMutation } from './outbox';
import {
  SERVER_PLACEHOLDER_VERSION,
  SERVER_PLACEHOLDER_CHANGE_SEQ,
  SERVER_PLACEHOLDER_TIMESTAMP,
  DEFAULT_USER_ID_FALLBACK,
} from './constants';
import { getProfile } from './profile';

export interface DeleteCategoryResult {
  archived: boolean;
  category: CategoryRow;
}

/**
 * Creates a category in SQLite and queues a 'create' mutation in the outbox atomically.
 */
export async function createCategory(
  db: DbLike,
  input: CreateCategoryInput,
  options?: WriteOptions
): Promise<RepositoryResult<CategoryRow>> {
  try {
    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: 'Category name cannot be empty' };
    }

    const icon = input.icon?.trim();
    if (!icon) {
      return { ok: false, error: 'Category icon cannot be empty' };
    }

    const color = input.color?.trim();
    if (!color) {
      return { ok: false, error: 'Category color cannot be empty' };
    }

    if (input.type !== 'income' && input.type !== 'expense') {
      return { ok: false, error: 'Category type must be income or expense' };
    }

    let createdCategory: CategoryRow | null = null;

    await db.withTransactionAsync(async () => {
      const resolvedUserId =
        input.userId ??
        input.user_id ??
        options?.userId ??
        (await getProfile(db))?.id ??
        DEFAULT_USER_ID_FALLBACK;

      const categoryId = generateClientUuid();
      const localRevision = 1;
      const archivedAt = input.archived_at ?? null;

      // 1. Insert local mirror row with placeholder server audit columns
      await db.runAsync(
        `INSERT INTO categories (
          id, user_id, name, icon, color, type, archived_at,
          version, change_seq, created_at, updated_at, deleted_at,
          local_revision, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending');`,
        [
          categoryId,
          resolvedUserId,
          name,
          icon,
          color,
          input.type,
          archivedAt,
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

      // 2. Insert outbox mutation with ONLY writable fields accepted by apply_mutation
      const payload: Record<string, unknown> = {
        name,
        icon,
        color,
        type: input.type,
        archived_at: archivedAt,
      };

      await recordOutboxMutation(db, {
        tableName: 'categories',
        entityId: categoryId,
        op: 'create',
        baseVersion: null,
        payload,
        localRevision,
      });

      createdCategory = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [categoryId]
      );
    });

    if (!createdCategory) {
      return { ok: false, error: 'Failed to create category' };
    }

    emitTableChange(['categories', 'outbox']);
    return { ok: true, value: createdCategory };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Updates a category locally and records or coalesces the mutation in the outbox.
 */
export async function updateCategory(
  db: DbLike,
  id: string,
  input: UpdateCategoryInput,
  options?: WriteOptions
): Promise<RepositoryResult<CategoryRow>> {
  try {
    let updatedCategory: CategoryRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Category not found or deleted');
      }

      const nextName = input.name !== undefined ? input.name.trim() : existing.name;
      if (!nextName) {
        throw new Error('Category name cannot be empty');
      }

      const nextIcon = input.icon !== undefined ? input.icon.trim() : existing.icon;
      if (!nextIcon) {
        throw new Error('Category icon cannot be empty');
      }

      const nextColor = input.color !== undefined ? input.color.trim() : existing.color;
      if (!nextColor) {
        throw new Error('Category color cannot be empty');
      }

      const nextType = input.type !== undefined ? input.type : existing.type;
      if (nextType !== 'income' && nextType !== 'expense') {
        throw new Error('Category type must be income or expense');
      }

      const nextArchivedAt =
        input.archived_at !== undefined ? input.archived_at : existing.archived_at;

      const nextRev = existing.local_revision + 1;

      // Update row in SQLite. Server version remains unchanged locally.
      await db.runAsync(
        `UPDATE categories SET
          name = ?, icon = ?, color = ?, type = ?, archived_at = ?,
          local_revision = ?, sync_state = 'pending'
        WHERE id = ?;`,
        [nextName, nextIcon, nextColor, nextType, nextArchivedAt, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      // Outbox payload with ONLY writable fields
      const payload: Record<string, unknown> = {
        name: nextName,
        icon: nextIcon,
        color: nextColor,
        type: nextType,
        archived_at: nextArchivedAt,
      };

      await recordOutboxMutation(db, {
        tableName: 'categories',
        entityId: id,
        op: 'update',
        baseVersion: existing.version,
        payload,
        localRevision: nextRev,
      });

      updatedCategory = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [id]
      );
    });

    if (!updatedCategory) {
      return { ok: false, error: 'Failed to update category' };
    }

    emitTableChange(['categories', 'outbox']);
    return { ok: true, value: updatedCategory };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Explicitly archives a category.
 * Archived categories remain visible in history but cannot be selected for new entries.
 */
export async function archiveCategory(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<CategoryRow>> {
  const nowIso = new Date().toISOString();
  return updateCategory(db, id, { archived_at: nowIso }, options);
}

/**
 * Deletes or archives a category per PRD Section 6.2 & Task 5:
 * - If the category has any non-deleted transactions, it is ARCHIVED, never deleted.
 * - If it has no transactions, it is soft-deleted with a 10s undo window.
 */
export async function deleteCategory(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<DeleteCategoryResult>> {
  try {
    let result: DeleteCategoryResult | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Category not found or already deleted');
      }

      // Check if category has historical non-deleted transactions
      const txCheck = await db.getFirstAsync<{ count: number }>(
        'SELECT count(*) as count FROM transactions WHERE category_id = ? AND deleted_at IS NULL;',
        [id]
      );
      const hasTransactions = (txCheck?.count ?? 0) > 0;

      if (hasTransactions) {
        // PRD 6.2: Archive categories with historical transactions
        const archiveRes = await updateCategory(
          db,
          id,
          { archived_at: new Date().toISOString() },
          options
        );
        if (!archiveRes.ok) {
          throw new Error(archiveRes.error);
        }
        result = { archived: true, category: archiveRes.value };
      } else {
        // Safe to soft-delete
        const nowIso = new Date().toISOString();
        const nextRev = existing.local_revision + 1;

        await db.runAsync(
          "UPDATE categories SET deleted_at = ?, local_revision = ?, sync_state = 'pending' WHERE id = ?;",
          [nowIso, nextRev, id]
        );

        if (options?._simulateFailureAfterRowWrite) {
          throw new Error('Simulated failure after row write');
        }

        const outboxOutcome = await recordOutboxMutation(db, {
          tableName: 'categories',
          entityId: id,
          op: 'delete',
          baseVersion: existing.version,
          payload: null,
          localRevision: nextRev,
        });

        if (outboxOutcome.rowDeletedLocally) {
          // Never-synced local row was pruned entirely
          result = { archived: false, category: { ...existing, deleted_at: nowIso } };
        } else {
          const fresh = await db.getFirstAsync<CategoryRow>(
            'SELECT * FROM categories WHERE id = ?;',
            [id]
          );
          result = { archived: false, category: fresh ?? { ...existing, deleted_at: nowIso } };
        }
      }
    });

    if (!result) {
      return { ok: false, error: 'Failed to process category deletion' };
    }

    emitTableChange(['categories', 'outbox']);
    return { ok: true, value: result };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Restores a soft-deleted category within the 10-second undo window.
 */
export async function restoreCategory(
  db: DbLike,
  id: string
): Promise<RepositoryResult<CategoryRow>> {
  return restoreOutboxMutation<CategoryRow>(db, 'categories', id);
}

/**
 * Retrieves a single category by ID (excluding soft-deleted categories).
 */
export async function getCategory(db: DbLike, id: string): Promise<CategoryRow | null> {
  return db.getFirstAsync<CategoryRow>(
    'SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL;',
    [id]
  );
}

/**
 * Lists categories (excluding soft-deleted rows).
 * By default excludes archived categories unless options.includeArchived is true.
 */
export async function listCategories(
  db: DbLike,
  options?: { includeArchived?: boolean }
): Promise<CategoryRow[]> {
  if (options?.includeArchived) {
    return db.getAllAsync<CategoryRow>(
      'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC;'
    );
  }

  return db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name COLLATE NOCASE ASC;'
  );
}
