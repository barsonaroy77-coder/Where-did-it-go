import { DbLike, RecurringRow, CategoryRow, RecurringFrequency } from '../types';
import { emitTableChange } from '../events';
import {
  CreateRecurringInput,
  UpdateRecurringInput,
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
import { MAX_AMOUNT } from '../../lib/money';
import { isValidDateString } from '../../lib/dates';
import { MAX_NOTE_LENGTH } from '../../lib/validation';

const VALID_FREQUENCIES: RecurringFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'bi-weekly',
  'monthly',
  'yearly',
  'annually',
];

/**
 * Creates a recurring rule in SQLite and queues an outbox mutation atomically.
 *
 * Rules:
 * - Validates monetary amounts, frequency, anchor_day, and calendar dates.
 * - Category must exist locally and NOT be deleted or archived.
 * - Category type must match recurring rule type (income vs expense).
 * - Row: assigns client UUID, local_revision = 1, sync_state = 'pending', server placeholders.
 * - Outbox: mutation_id = client UUID, op = 'create', base_version = null, payload with writable fields only.
 */
export async function createRecurring(
  db: DbLike,
  input: CreateRecurringInput,
  options?: WriteOptions
): Promise<RepositoryResult<RecurringRow>> {
  try {
    if (input.type !== 'income' && input.type !== 'expense') {
      return { ok: false, error: 'Type must be income or expense' };
    }

    if (
      typeof input.amount !== 'number' ||
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0 ||
      input.amount > MAX_AMOUNT
    ) {
      return { ok: false, error: 'Amount must be a positive safe integer' };
    }

    if (!input.category_id || typeof input.category_id !== 'string') {
      return { ok: false, error: 'category_id is required' };
    }

    const freq = input.frequency?.trim()?.toLowerCase() as RecurringFrequency;
    if (!VALID_FREQUENCIES.includes(freq)) {
      return { ok: false, error: `Invalid recurring frequency: ${input.frequency}` };
    }

    if (!isValidDateString(input.start_date)) {
      return { ok: false, error: 'start_date must be in YYYY-MM-DD format' };
    }

    if (!isValidDateString(input.next_date)) {
      return { ok: false, error: 'next_date must be in YYYY-MM-DD format' };
    }

    const tz = input.schedule_timezone?.trim();
    if (!tz) {
      return { ok: false, error: 'schedule_timezone cannot be empty' };
    }

    if (
      typeof input.anchor_day !== 'number' ||
      !Number.isInteger(input.anchor_day) ||
      input.anchor_day < 1 ||
      input.anchor_day > 31
    ) {
      return { ok: false, error: 'anchor_day must be an integer between 1 and 31' };
    }

    if (input.note && input.note.length > MAX_NOTE_LENGTH) {
      return { ok: false, error: 'Note exceeds maximum length' };
    }

    const isActive = input.is_active === undefined ? 1 : input.is_active ? 1 : 0;

    let createdRecurring: RecurringRow | null = null;

    await db.withTransactionAsync(async () => {
      // Validate category
      const category = await db.getFirstAsync<CategoryRow>(
        'SELECT * FROM categories WHERE id = ?;',
        [input.category_id]
      );

      if (!category || category.deleted_at !== null) {
        throw new Error('Category does not exist or has been deleted');
      }

      if (category.archived_at !== null) {
        throw new Error('Category is archived and cannot be used for recurring rules');
      }

      if (category.type !== input.type) {
        throw new Error(
          `Category type mismatch: category is '${category.type}' but recurring rule is '${input.type}'`
        );
      }

      const recurringId = generateClientUuid();
      const localRevision = 1;
      const note = input.note?.trim() || null;
      const userId = category.user_id;

      await db.runAsync(
        `INSERT INTO recurring (
          id, user_id, type, amount, category_id, note, frequency,
          start_date, next_date, schedule_timezone, anchor_day, is_active,
          version, change_seq, created_at, updated_at, deleted_at,
          local_revision, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending');`,
        [
          recurringId,
          userId,
          input.type,
          input.amount,
          input.category_id,
          note,
          freq,
          input.start_date,
          input.next_date,
          tz,
          input.anchor_day,
          isActive,
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
        type: input.type,
        amount: input.amount,
        category_id: input.category_id,
        note,
        frequency: freq,
        start_date: input.start_date,
        next_date: input.next_date,
        schedule_timezone: tz,
        anchor_day: input.anchor_day,
        is_active: Boolean(isActive),
      };

      await recordOutboxMutation(db, {
        tableName: 'recurring',
        entityId: recurringId,
        op: 'create',
        baseVersion: null,
        payload,
        localRevision,
      });

      createdRecurring = await db.getFirstAsync<RecurringRow>(
        'SELECT * FROM recurring WHERE id = ?;',
        [recurringId]
      );
    });

    if (!createdRecurring) {
      return { ok: false, error: 'Failed to create recurring rule' };
    }

    emitTableChange(['recurring', 'outbox']);
    return { ok: true, value: createdRecurring };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Updates an existing recurring rule locally and coalesces the mutation in the outbox.
 */
export async function updateRecurring(
  db: DbLike,
  id: string,
  input: UpdateRecurringInput,
  options?: WriteOptions
): Promise<RepositoryResult<RecurringRow>> {
  try {
    let updatedRecurring: RecurringRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<RecurringRow>(
        'SELECT * FROM recurring WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Recurring rule not found or deleted');
      }

      const merged = {
        type: input.type !== undefined ? input.type : existing.type,
        amount: input.amount !== undefined ? input.amount : existing.amount,
        category_id: input.category_id !== undefined ? input.category_id : existing.category_id,
        note: input.note !== undefined ? input.note : existing.note,
        frequency:
          input.frequency !== undefined
            ? (input.frequency.trim().toLowerCase() as RecurringFrequency)
            : existing.frequency,
        start_date: input.start_date !== undefined ? input.start_date : existing.start_date,
        next_date: input.next_date !== undefined ? input.next_date : existing.next_date,
        schedule_timezone:
          input.schedule_timezone !== undefined
            ? input.schedule_timezone.trim()
            : existing.schedule_timezone,
        anchor_day: input.anchor_day !== undefined ? input.anchor_day : existing.anchor_day,
        is_active:
          input.is_active !== undefined
            ? input.is_active
              ? 1
              : 0
            : existing.is_active,
      };

      if (merged.type !== 'income' && merged.type !== 'expense') {
        throw new Error('Type must be income or expense');
      }

      if (
        typeof merged.amount !== 'number' ||
        !Number.isSafeInteger(merged.amount) ||
        merged.amount <= 0 ||
        merged.amount > MAX_AMOUNT
      ) {
        throw new Error('Amount must be a positive safe integer');
      }

      if (!VALID_FREQUENCIES.includes(merged.frequency)) {
        throw new Error(`Invalid recurring frequency: ${merged.frequency}`);
      }

      if (!isValidDateString(merged.start_date)) {
        throw new Error('start_date must be in YYYY-MM-DD format');
      }

      if (!isValidDateString(merged.next_date)) {
        throw new Error('next_date must be in YYYY-MM-DD format');
      }

      if (!merged.schedule_timezone) {
        throw new Error('schedule_timezone cannot be empty');
      }

      if (
        typeof merged.anchor_day !== 'number' ||
        !Number.isInteger(merged.anchor_day) ||
        merged.anchor_day < 1 ||
        merged.anchor_day > 31
      ) {
        throw new Error('anchor_day must be an integer between 1 and 31');
      }

      if (merged.note && merged.note.length > MAX_NOTE_LENGTH) {
        throw new Error('Note exceeds maximum length');
      }

      if (merged.category_id !== existing.category_id || merged.type !== existing.type) {
        const category = await db.getFirstAsync<CategoryRow>(
          'SELECT * FROM categories WHERE id = ?;',
          [merged.category_id]
        );

        if (!category || category.deleted_at !== null) {
          throw new Error('Category does not exist or has been deleted');
        }

        if (merged.category_id !== existing.category_id && category.archived_at !== null) {
          throw new Error('Category is archived and cannot be selected for recurring rule');
        }

        if (category.type !== merged.type) {
          throw new Error(
            `Category type mismatch: category is '${category.type}' but recurring rule is '${merged.type}'`
          );
        }
      }

      const nextRev = existing.local_revision + 1;
      const note = merged.note?.trim() || null;

      await db.runAsync(
        `UPDATE recurring SET
          type = ?, amount = ?, category_id = ?, note = ?, frequency = ?,
          start_date = ?, next_date = ?, schedule_timezone = ?, anchor_day = ?, is_active = ?,
          local_revision = ?, sync_state = 'pending'
        WHERE id = ?;`,
        [
          merged.type,
          merged.amount,
          merged.category_id,
          note,
          merged.frequency,
          merged.start_date,
          merged.next_date,
          merged.schedule_timezone,
          merged.anchor_day,
          merged.is_active,
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
        frequency: merged.frequency,
        start_date: merged.start_date,
        next_date: merged.next_date,
        schedule_timezone: merged.schedule_timezone,
        anchor_day: merged.anchor_day,
        is_active: Boolean(merged.is_active),
      };

      await recordOutboxMutation(db, {
        tableName: 'recurring',
        entityId: id,
        op: 'update',
        baseVersion: existing.version,
        payload,
        localRevision: nextRev,
      });

      updatedRecurring = await db.getFirstAsync<RecurringRow>(
        'SELECT * FROM recurring WHERE id = ?;',
        [id]
      );
    });

    if (!updatedRecurring) {
      return { ok: false, error: 'Failed to update recurring rule' };
    }

    emitTableChange(['recurring', 'outbox']);
    return { ok: true, value: updatedRecurring };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Soft-deletes a recurring rule with a 10-second undo window.
 */
export async function softDeleteRecurring(
  db: DbLike,
  id: string,
  options?: WriteOptions
): Promise<RepositoryResult<RecurringRow>> {
  try {
    let resultRow: RecurringRow | null = null;

    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<RecurringRow>(
        'SELECT * FROM recurring WHERE id = ?;',
        [id]
      );

      if (!existing || existing.deleted_at !== null) {
        throw new Error('Recurring rule not found or already deleted');
      }

      const nowIso = new Date().toISOString();
      const nextRev = existing.local_revision + 1;

      await db.runAsync(
        "UPDATE recurring SET deleted_at = ?, local_revision = ?, sync_state = 'pending' WHERE id = ?;",
        [nowIso, nextRev, id]
      );

      if (options?._simulateFailureAfterRowWrite) {
        throw new Error('Simulated failure after row write');
      }

      const outcome = await recordOutboxMutation(db, {
        tableName: 'recurring',
        entityId: id,
        op: 'delete',
        baseVersion: existing.version,
        payload: null,
        localRevision: nextRev,
      });

      if (outcome.rowDeletedLocally) {
        resultRow = { ...existing, deleted_at: nowIso };
      } else {
        const fresh = await db.getFirstAsync<RecurringRow>(
          'SELECT * FROM recurring WHERE id = ?;',
          [id]
        );
        resultRow = fresh ?? { ...existing, deleted_at: nowIso };
      }
    });

    if (!resultRow) {
      return { ok: false, error: 'Failed to delete recurring rule' };
    }

    emitTableChange(['recurring', 'outbox']);
    return { ok: true, value: resultRow };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Restores a soft-deleted recurring rule within the 10-second undo window.
 */
export async function restoreRecurring(
  db: DbLike,
  id: string
): Promise<RepositoryResult<RecurringRow>> {
  return restoreOutboxMutation<RecurringRow>(db, 'recurring', id);
}

/**
 * Retrieves a single recurring rule by ID (excluding soft-deleted rows).
 */
export async function getRecurring(db: DbLike, id: string): Promise<RecurringRow | null> {
  return db.getFirstAsync<RecurringRow>(
    'SELECT * FROM recurring WHERE id = ? AND deleted_at IS NULL;',
    [id]
  );
}

/**
 * Lists all active recurring rules (excluding soft-deleted rows).
 */
export async function listRecurring(db: DbLike): Promise<RecurringRow[]> {
  return db.getAllAsync<RecurringRow>(
    'SELECT * FROM recurring WHERE deleted_at IS NULL ORDER BY created_at ASC;'
  );
}
