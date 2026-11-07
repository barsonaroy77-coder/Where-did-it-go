import { DbLike, GoalRow } from '../types';
import {
  CreateGoalInput,
  UpdateGoalInput,
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
import { validateGoalInput } from '../../lib/validation';
import { firstOfMonth, isValidDateString } from '../../lib/dates';

/**
 * Creates a monthly savings goal in SQLite and queues an outbox mutation atomically.
 *
 * Rules:
 * - Validates input using pure validateGoalInput.
 * - Enforces that month is strictly the first of a calendar month (YYYY-MM-01).
 * - Row: assigns client UUID, local_revision = 1, sync_state = 'pending', server placeholders.
 * - Outbox: mutation_id = client UUID, op = 'create', base_version = null, payload with writable fields only.
 */
export async function createGoal(
  db: DbLike,
  input: CreateGoalInput,
  options?: WriteOptions
): Promise<RepositoryResult<GoalRow>> {
  try {
    const valResult = validateGoalInput(input);
    if (!valResult.ok) {
      return { ok: false, error: valResult.errors.join(', ') };
    }

    const month = firstOfMonth(input.month);
    if (!isValidDateString(month) || !month.endsWith('-01')) {
      return { ok: false, error: 'Goal month must be the first of a month (YYYY-MM-01)' };
    }

    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: 'Goal name cannot be empty' };
    }

    let createdGoal: GoalRow | null = null;

    await db.withTransactionAsync(async () => {
      const resolvedUserId =
        input.userId ??
        input.user_id ??
        options?.userId ??
        (await getProfile(db))?.id ??
        DEFAULT_USER_ID_FALLBACK;

      const goalId = generateClientUuid();
      const localRevision = 1;

      await db.runAsync(
        `INSERT INTO goals (
          id, user_id, name, target_amount, month,
          version, change_seq, created_at, updated_at, deleted_at,
          local_revision, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending');`,
        [
          goalId,
          resolvedUserId,
          name,
          input.target_amount,
          month,
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

      // Outbox payload with ONLY writable fields accepted by apply_mutation
      const payload: Record<string, unknown> = {
        name,
        target_amount: input.target_amount,
        month,
      };

      await recordOutboxMutation(db, {
        tableName: 'goals',
        entityId: goalId,
        op: 'create',
        baseVersion: null,
        payload,
        localRevision,
      });

      createdGoal = await db.getFirstAsync<GoalRow>(
        'SELECT * FROM goals WHERE id = ?;',
        [goalId]
      );
    });

    if (!createdGoal) {
      return { ok: false, error: 'Failed to create goal' };
    }

    return { ok: true, value: createdGoal };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Updates an existing savings goal locally and coalesces the mutation in the outbox.
 */
export async function updateGoal(
  db: DbLike,
  id: string,
  input: UpdateGoalInput,
  options?: WriteOptions
): Promise<RepositoryResult<GoalRow>> {
  try {
    let updatedGoal: GoalRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<GoalRow>(
        'SELECT * FROM goals WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Goal not found or deleted');
      }

      const merged = {
        name: input.name !== undefined ? input.name.trim() : existing.name,
        target_amount:
          input.target_amount !== undefined ? input.target_amount : existing.target_amount,
        month: input.month !== undefined ? firstOfMonth(input.month) : existing.month,
      };

      const valResult = validateGoalInput(merged);
      if (!valResult.ok) {
        throw new Error(valResult.errors.join(', '));
      }

      if (!isValidDateString(merged.month) || !merged.month.endsWith('-01')) {
        throw new Error('Goal month must be the first of a month (YYYY-MM-01)');
      }

      if (!merged.name) {
        throw new Error('Goal name cannot be empty');
      }

      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        `UPDATE goals SET
          name = ?, target_amount = ?, month = ?,
          local_revision = ?, sync_state = 'pending'
        WHERE id = ?;`,
        [merged.name, merged.target_amount, merged.month, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const payload: Record<string, unknown> = {
        name: merged.name,
        target_amount: merged.target_amount,
        month: merged.month,
      };

      await recordOutboxMutation(db, {
        tableName: 'goals',
        entityId: id,
        op: 'update',
        baseVersion: existing.version,
        payload,
        localRevision: nextRev,
      });

      updatedGoal = await db.getFirstAsync<GoalRow>(
        'SELECT * FROM goals WHERE id = ?;',
        [id]
      );
    });

    if (!updatedGoal) {
      return { ok: false, error: 'Failed to update goal' };
    }

    return { ok: true, value: updatedGoal };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Soft-deletes a savings goal with a 10-second undo window.
 */
export async function softDeleteGoal(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<GoalRow>> {
  try {
    let resultRow: GoalRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<GoalRow>(
        'SELECT * FROM goals WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Goal not found or already deleted');
      }

      const nowIso = new Date().toISOString();
      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        "UPDATE goals SET deleted_at = ?, local_revision = ?, sync_state = 'pending' WHERE id = ?;",
        [nowIso, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const outcome = await recordOutboxMutation(db, {
        tableName: 'goals',
        entityId: id,
        op: 'delete',
        baseVersion: existing.version,
        payload: null,
        localRevision: nextRev,
      });

      if (outcome.rowDeletedLocally) {
        resultRow = { ...existing, deleted_at: nowIso };
      } else {
        const fresh = await db.getFirstAsync<GoalRow>(
          'SELECT * FROM goals WHERE id = ?;',
          [id]
        );
        resultRow = fresh ?? { ...existing, deleted_at: nowIso };
      }
    });

    if (!resultRow) {
      return { ok: false, error: 'Failed to delete goal' };
    }

    return { ok: true, value: resultRow };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Restores a soft-deleted goal within the 10-second undo window.
 */
export async function restoreGoal(
  db: DbLike,
  id: string
): Promise<RepositoryResult<GoalRow>> {
  return restoreOutboxMutation<GoalRow>(db, 'goals', id);
}

/**
 * Retrieves a single savings goal by ID (excluding soft-deleted rows).
 */
export async function getGoal(db: DbLike, id: string): Promise<GoalRow | null> {
  return db.getFirstAsync<GoalRow>(
    'SELECT * FROM goals WHERE id = ? AND deleted_at IS NULL;',
    [id]
  );
}

/**
 * Retrieves a savings goal for a specific month (YYYY-MM or YYYY-MM-01).
 * Excludes soft-deleted rows.
 */
export async function getGoalForMonth(db: DbLike, month: string): Promise<GoalRow | null> {
  const normalizedMonth = firstOfMonth(month);
  return db.getFirstAsync<GoalRow>(
    'SELECT * FROM goals WHERE month = ? AND deleted_at IS NULL LIMIT 1;',
    [normalizedMonth]
  );
}

/**
 * Lists savings goals for a specific month (YYYY-MM or YYYY-MM-01).
 * Excludes soft-deleted rows.
 */
export async function listGoalsForMonth(db: DbLike, month: string): Promise<GoalRow[]> {
  const normalizedMonth = firstOfMonth(month);
  return db.getAllAsync<GoalRow>(
    'SELECT * FROM goals WHERE month = ? AND deleted_at IS NULL ORDER BY created_at ASC;',
    [normalizedMonth]
  );
}

/**
 * Lists all active savings goals across all months (excluding soft-deleted rows).
 */
export async function listGoals(db: DbLike): Promise<GoalRow[]> {
  return db.getAllAsync<GoalRow>(
    'SELECT * FROM goals WHERE deleted_at IS NULL ORDER BY month DESC, created_at ASC;'
  );
}
