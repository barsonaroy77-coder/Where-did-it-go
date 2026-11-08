import { DbLike, OutboxRow, SyncedTableName, MutationOp } from '../types';
import { generateClientUuid } from './uuid';
import { RepositoryResult } from './types';
import { emitTableChange } from '../events';

export interface OutboxMutationOutcome {
  mutationId: string;
  op: MutationOp;
  coalesced: boolean;
  rowDeletedLocally?: boolean;
}

/**
 * =============================================================================
 * OUTBOX COALESCING RULES & IMPLEMENTATION
 * =============================================================================
 * Several edits to one entity before a sync occurs must not produce conflicting
 * outbox entries with the same base_version. This repository implements and
 * enforces the following coalescing rules within atomic SQLite transactions:
 *
 * 1. Existing 'pending' entry for the same entity, new op 'update':
 *    - Replace its payload with the merged latest payload.
 *    - Preserve its original op (e.g. if it was 'create', keep 'create') and its
 *      original base_version.
 *    - Preserve its original mutation_id (does not generate a new mutation ID).
 *
 * 2. Pending 'create' + new 'delete':
 *    - The entity was created offline and has never been pushed to the backend
 *      (the server has never seen it).
 *    - Remove the pending outbox entry completely.
 *    - Remove the never-synced row entirely from the SQLite table (physical delete).
 *    - No server call or outbox entry remains.
 *
 * 3. Pending 'update' + new 'delete':
 *    - Turn the pending update entry into a single 'delete' entry.
 *    - Keep its original mutation_id and base_version.
 *    - Set payload to NULL (or empty) and arm next_attempt_at = now + 10s for the
 *      5-second undo toast window.
 *
 * 4. Existing entry 'in_flight':
 *    - Do NOT modify the in_flight entry (it is currently being sent or awaiting
 *      server response).
 *    - Add a brand-new 'pending' entry whose base_version is NULL.
 *    - COMMENT FOR PHASE 4 PART 6: The sync engine fills this NULL base_version
 *      from the previous in-flight mutation's server acknowledgment response
 *      before dispatching this pending mutation.
 *
 * 5. Every entry that is rewritten preserves its original mutation_id unless
 *    it is a brand-new entry.
 * =============================================================================
 */

export interface RecordOutboxParams {
  tableName: SyncedTableName;
  entityId: string;
  op: MutationOp;
  baseVersion: number | null;
  payload: Record<string, unknown> | null;
  localRevision: number;
}

export async function recordOutboxMutation(
  db: DbLike,
  params: RecordOutboxParams
): Promise<OutboxMutationOutcome> {
  const { tableName, entityId, op, baseVersion, payload, localRevision } = params;

  // Retrieve existing outbox entries for this entity, newest sequence first
  const existingEntries = await db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE table_name = ? AND entity_id = ? ORDER BY sequence DESC;',
    [tableName, entityId]
  );

  const pendingEntry = existingEntries.find((e) => e.status === 'pending');
  const inFlightEntry = existingEntries.find((e) => e.status === 'in_flight');

  // ---------------------------------------------------------------------------
  // Case A: Existing 'pending' entry for this entity
  // ---------------------------------------------------------------------------
  if (pendingEntry) {
    if (op === 'update') {
      // Coalescing Rule 1: Merge payload, keep op, base_version, and mutation_id
      let existingPayload: Record<string, unknown> = {};
      if (pendingEntry.payload) {
        try {
          existingPayload = JSON.parse(pendingEntry.payload);
        } catch {
          existingPayload = {};
        }
      }

      const mergedPayload = { ...existingPayload, ...(payload ?? {}) };
      const mergedPayloadStr = JSON.stringify(mergedPayload);

      await db.runAsync(
        'UPDATE outbox SET payload = ?, local_revision = ? WHERE sequence = ?;',
        [mergedPayloadStr, localRevision, pendingEntry.sequence]
      );

      return {
        mutationId: pendingEntry.mutation_id,
        op: pendingEntry.op,
        coalesced: true,
      };
    }

    if (op === 'delete') {
      if (pendingEntry.op === 'create') {
        // Coalescing Rule 2: Pending create + new delete -> delete outbox entry and remove row entirely
        await db.runAsync('DELETE FROM outbox WHERE sequence = ?;', [pendingEntry.sequence]);
        await db.runAsync(`DELETE FROM ${tableName} WHERE id = ?;`, [entityId]);

        return {
          mutationId: pendingEntry.mutation_id,
          op: 'delete',
          coalesced: true,
          rowDeletedLocally: true,
        };
      }

      if (pendingEntry.op === 'update') {
        // Coalescing Rule 3: Pending update + new delete -> rewrite as single delete entry
        const nextAttemptAt = new Date(Date.now() + 10_000).toISOString();
        await db.runAsync(
          "UPDATE outbox SET op = 'delete', payload = NULL, local_revision = ?, next_attempt_at = ? WHERE sequence = ?;",
          [localRevision, nextAttemptAt, pendingEntry.sequence]
        );

        return {
          mutationId: pendingEntry.mutation_id,
          op: 'delete',
          coalesced: true,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Case B: Existing entry is 'in_flight'
  // ---------------------------------------------------------------------------
  if (inFlightEntry) {
    // Coalescing Rule 4: Do NOT modify in_flight entry.
    // Add a new 'pending' entry whose base_version is NULL.
    // Phase 4 Part 6 (Sync Engine) fills base_version from the previous
    // mutation's server acknowledgment response before dispatching.
    const newMutationId = generateClientUuid();
    const payloadStr = payload ? JSON.stringify(payload) : null;
    const nowIso = new Date().toISOString();
    const nextAttemptAt = op === 'delete' ? new Date(Date.now() + 10_000).toISOString() : null;

    await db.runAsync(
      `INSERT INTO outbox (
        mutation_id, table_name, entity_id, op, base_version, payload,
        local_revision, status, attempt_count, last_error, next_attempt_at, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'pending', 0, NULL, ?, ?);`,
      [newMutationId, tableName, entityId, op, payloadStr, localRevision, nextAttemptAt, nowIso]
    );

    return {
      mutationId: newMutationId,
      op,
      coalesced: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Case C: No pending or in_flight entry -> Create brand-new outbox entry
  // ---------------------------------------------------------------------------
  const newMutationId = generateClientUuid();
  const payloadStr = payload ? JSON.stringify(payload) : null;
  const nowIso = new Date().toISOString();
  // PRD 6.1 / Task 4: Deletion sets next_attempt_at = now + 10s for the 5-second undo toast window
  const nextAttemptAt = op === 'delete' ? new Date(Date.now() + 10_000).toISOString() : null;
  const finalBaseVersion = op === 'create' ? null : baseVersion;

  await db.runAsync(
    `INSERT INTO outbox (
      mutation_id, table_name, entity_id, op, base_version, payload,
      local_revision, status, attempt_count, last_error, next_attempt_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?);`,
    [
      newMutationId,
      tableName,
      entityId,
      op,
      finalBaseVersion,
      payloadStr,
      localRevision,
      nextAttemptAt,
      nowIso,
    ]
  );

  return {
    mutationId: newMutationId,
    op,
    coalesced: false,
  };
}

/**
 * Undoes a soft-delete operation if called within the local undo window.
 *
 * Requirements (Task 4):
 * - If a pending delete entry exists in the outbox, removes the outbox entry and
 *   clears deleted_at locally with zero server calls.
 * - If the delete entry is already 'in_flight' or sent, returns a clear error:
 *   "Too late to undo".
 *
 * NOTE: Real server-side restore is out of scope for v1 because apply_mutation
 * has no restore operation in its server endpoint schema.
 */
export async function restoreOutboxMutation<T extends { id: string }>(
  db: DbLike,
  tableName: SyncedTableName,
  entityId: string
): Promise<RepositoryResult<T>> {
  try {
    let restoredRow: T | null = null;

    await db.withTransactionAsync(async () => {
      // 1. Fetch current row
      const row = await db.getFirstAsync<T & { deleted_at?: string | null; local_revision?: number }>(
        `SELECT * FROM ${tableName} WHERE id = ?;`,
        [entityId]
      );

      if (!row) {
        throw new Error('Entity not found');
      }

      if (row.deleted_at === null || row.deleted_at === undefined) {
        throw new Error('Entity is not deleted');
      }

      // 2. Inspect outbox entries
      const entries = await db.getAllAsync<OutboxRow>(
        'SELECT * FROM outbox WHERE table_name = ? AND entity_id = ? ORDER BY sequence DESC;',
        [tableName, entityId]
      );

      const inFlight = entries.find((e) => e.status === 'in_flight');
      if (inFlight) {
        throw new Error('Too late to undo');
      }

      const pendingDelete = entries.find((e) => e.status === 'pending' && e.op === 'delete');
      if (!pendingDelete) {
        // If there's no pending delete entry and no in-flight entry, it has already been sent to server
        throw new Error('Too late to undo');
      }

      // 3. Remove the pending delete entry
      await db.runAsync('DELETE FROM outbox WHERE sequence = ?;', [pendingDelete.sequence]);

      // 4. Clear deleted_at and update sync_state
      const remainingPending = await db.getFirstAsync<{ count: number }>(
        "SELECT count(*) as count FROM outbox WHERE entity_id = ? AND status = 'pending';",
        [entityId]
      );

      const nextSyncState = (remainingPending?.count ?? 0) > 0 ? 'pending' : 'synced';
      const nextRev = (row.local_revision ?? 0) + 1;

      await db.runAsync(
        `UPDATE ${tableName} SET deleted_at = NULL, sync_state = ?, local_revision = ? WHERE id = ?;`,
        [nextSyncState, nextRev, entityId]
      );

      restoredRow = await db.getFirstAsync<T>(`SELECT * FROM ${tableName} WHERE id = ?;`, [entityId]);
    });

    if (!restoredRow) {
      return { ok: false, error: 'Entity could not be restored' };
    }

    emitTableChange([tableName, 'outbox']);
    return { ok: true, value: restoredRow };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Read-only helper: Returns the count of pending outbox mutations.
 * Used for sync status indicators.
 */
export async function getPendingCount(db: DbLike): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT count(*) as count FROM outbox WHERE status = 'pending';"
  );
  return result?.count ?? 0;
}

/**
 * Read-only helper: Returns all outbox entries ordered by sequence.
 * Used for sync inspection and debugging UI.
 */
export async function getOutboxEntries(db: DbLike): Promise<OutboxRow[]> {
  return db.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY sequence ASC;');
}
