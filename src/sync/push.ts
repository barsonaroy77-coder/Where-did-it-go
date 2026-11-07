import { DbLike, OutboxRow } from '@/db/types';
import { SyncRemote, OutboxEntry, SyncRemoteError, classifyRemoteError } from './remote';
import { setGlobalSyncPaused } from './state';

export interface PushSummary {
  pushed: number;
  failed: number;
  blocked: number;
  stoppedBecause?: 'network_error' | 'auth_error' | null;
}

/**
 * Calculates exponential backoff with full jitter, capped at 5 minutes (300,000 ms).
 * Base sequence: 1s, 2s, 4s, 8s, 16s... + random jitter [0, 1000ms).
 */
export function calculateBackoffWithJitter(attemptCount: number): number {
  const exp = Math.min(attemptCount - 1, 10);
  const baseDelay = 1000 * Math.pow(2, Math.max(0, exp));
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(300_000, baseDelay + jitter);
}

/**
 * Marks outbox entries of transactions that reference a failed or blocked category
 * as 'blocked' with a descriptive error message to preserve dependency order.
 */
async function blockDependentTransactions(
  db: DbLike,
  categoryId: string,
  categoryMutationId: string,
  reason: string
): Promise<number> {
  const reasonMessage = `Category mutation ${categoryMutationId} ${reason} (dependency blocked)`;
  let blockedCount = 0;

  // 1. Transactions present in the transactions table referencing this category
  const txRows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM transactions WHERE category_id = ?;',
    [categoryId]
  );
  const txIds = new Set<string>(txRows.map((r) => r.id));

  // 2. Pending or in_flight outbox entries for transactions
  const pendingTxEntries = await db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE table_name = 'transactions' AND status IN ('pending', 'in_flight');"
  );

  for (const entry of pendingTxEntries) {
    let referencesCategory = txIds.has(entry.entity_id);
    if (!referencesCategory && entry.payload) {
      try {
        const parsed = JSON.parse(entry.payload) as { category_id?: string };
        if (parsed.category_id === categoryId) {
          referencesCategory = true;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    if (referencesCategory) {
      await db.runAsync(
        "UPDATE outbox SET status = 'blocked', last_error = ? WHERE sequence = ?;",
        [reasonMessage, entry.sequence]
      );
      blockedCount++;
    }
  }

  return blockedCount;
}

/**
 * Pushes eligible pending mutations from the local outbox to the remote backend.
 * Operates strictly on categories and transactions prototype.
 */
export async function pushOutbox(
  db: DbLike,
  remote: SyncRemote
): Promise<PushSummary> {
  let pushedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;

  const nowIso = new Date().toISOString();

  // 1. Process entries ordered by sequence where status = 'pending' and next_attempt_at is null or in the past
  const candidateEntries = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox
     WHERE status = 'pending'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY sequence ASC;`,
    [nowIso]
  );

  for (const entry of candidateEntries) {
    // Re-verify that the entry is still pending (it might have been blocked by a preceding category failure)
    const currentEntry = await db.getFirstAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE sequence = ?;',
      [entry.sequence]
    );

    if (!currentEntry || currentEntry.status !== 'pending') {
      continue;
    }

    let effectiveBaseVersion = currentEntry.base_version;

    // Rule: If an entry is 'pending' with base_version NULL and its entity already has
    // an acknowledged version (queued behind an in_flight entry), fill base_version
    // from the row's current known server version just before sending.
    if (currentEntry.op !== 'create' && currentEntry.base_version === null) {
      const knownRow = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM ${currentEntry.table_name} WHERE id = ?;`,
        [currentEntry.entity_id]
      );

      if (knownRow && knownRow.version > 0) {
        effectiveBaseVersion = knownRow.version;
        await db.runAsync(
          'UPDATE outbox SET base_version = ? WHERE sequence = ?;',
          [knownRow.version, currentEntry.sequence]
        );
      }
    }

    // Rule: Mark an entry 'in_flight' BEFORE sending. Keep its mutation_id for every retry
    await db.runAsync(
      "UPDATE outbox SET status = 'in_flight' WHERE sequence = ?;",
      [currentEntry.sequence]
    );

    const outboxPayloadToSend: OutboxEntry = {
      sequence: currentEntry.sequence,
      mutation_id: currentEntry.mutation_id,
      table_name: currentEntry.table_name,
      entity_id: currentEntry.entity_id,
      op: currentEntry.op,
      base_version: effectiveBaseVersion,
      payload: currentEntry.payload,
      local_revision: currentEntry.local_revision,
    };

    try {
      const result = await remote.applyMutation(outboxPayloadToSend);

      if (result.status === 'applied') {
        const serverRow = result.entity;
        if (!serverRow) {
          throw new SyncRemoteError(
            'server',
            'apply_mutation returned status applied with null entity'
          );
        }

        // Rule: In ONE SQLite transaction:
        // - write returned server row into local table
        // - delete outbox entry
        // - set sync_state 'synced' only if no other entry for that entity remains, otherwise keep 'pending'
        // - update base_version of any later pending entry for the same entity
        await db.withTransactionAsync(async () => {
          if (currentEntry.table_name === 'categories') {
            await db.runAsync(
              `INSERT INTO categories (
                 id, user_id, name, icon, color, type, archived_at,
                 version, change_seq, created_at, updated_at, deleted_at,
                 local_revision, sync_state
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 user_id = excluded.user_id,
                 name = excluded.name,
                 icon = excluded.icon,
                 color = excluded.color,
                 type = excluded.type,
                 archived_at = excluded.archived_at,
                 version = excluded.version,
                 change_seq = excluded.change_seq,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at;`,
              [
                serverRow.id as string,
                serverRow.user_id as string,
                serverRow.name as string,
                serverRow.icon as string,
                serverRow.color as string,
                serverRow.type as string,
                (serverRow.archived_at as string | null) ?? null,
                serverRow.version as number,
                serverRow.change_seq as number,
                serverRow.created_at as string,
                serverRow.updated_at as string,
                (serverRow.deleted_at as string | null) ?? null,
              ]
            );
          } else if (currentEntry.table_name === 'transactions') {
            await db.runAsync(
              `INSERT INTO transactions (
                 id, user_id, type, amount, category_id, note, date,
                 recurring_id, occurrence_date,
                 version, change_seq, created_at, updated_at, deleted_at,
                 local_revision, sync_state
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 user_id = excluded.user_id,
                 type = excluded.type,
                 amount = excluded.amount,
                 category_id = excluded.category_id,
                 note = excluded.note,
                 date = excluded.date,
                 recurring_id = excluded.recurring_id,
                 occurrence_date = excluded.occurrence_date,
                 version = excluded.version,
                 change_seq = excluded.change_seq,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at;`,
              [
                serverRow.id as string,
                serverRow.user_id as string,
                serverRow.type as string,
                serverRow.amount as number,
                serverRow.category_id as string,
                (serverRow.note as string | null) ?? null,
                serverRow.date as string,
                (serverRow.recurring_id as string | null) ?? null,
                (serverRow.occurrence_date as string | null) ?? null,
                serverRow.version as number,
                serverRow.change_seq as number,
                serverRow.created_at as string,
                serverRow.updated_at as string,
                (serverRow.deleted_at as string | null) ?? null,
              ]
            );
          }

          // Delete the outbox entry
          await db.runAsync('DELETE FROM outbox WHERE sequence = ?;', [currentEntry.sequence]);

          // Set sync_state 'synced' only if no other entry for that entity remains
          const remaining = await db.getFirstAsync<{ count: number }>(
            'SELECT count(*) as count FROM outbox WHERE entity_id = ? AND table_name = ?;',
            [currentEntry.entity_id, currentEntry.table_name]
          );

          const syncState = (remaining?.count ?? 0) === 0 ? 'synced' : 'pending';
          await db.runAsync(
            `UPDATE ${currentEntry.table_name} SET sync_state = ? WHERE id = ?;`,
            [syncState, currentEntry.entity_id]
          );

          // Update base_version of any later pending entry for the same entity
          if (typeof serverRow.version === 'number') {
            await db.runAsync(
              `UPDATE outbox SET base_version = ?
               WHERE table_name = ? AND entity_id = ? AND status = 'pending';`,
              [serverRow.version, currentEntry.table_name, currentEntry.entity_id]
            );
          }
        });

        pushedCount++;
      } else if (result.status === 'conflict') {
        // Rule: status 'conflict': in ONE transaction, insert a conflicts row
        // (local payload and the server row returned), set the entity's sync_state 'conflict',
        // mark the entry 'blocked'. NEVER overwrite local or server data.
        // Later pending entries for that entity stay blocked too.
        await db.withTransactionAsync(async () => {
          const conflictServerRowStr = JSON.stringify(result.entity ?? {});
          const conflictNow = new Date().toISOString();

          await db.runAsync(
            `INSERT INTO conflicts (
               mutation_id, table_name, entity_id, local_payload, server_row, created_at
             ) VALUES (?, ?, ?, ?, ?, ?);`,
            [
              currentEntry.mutation_id,
              currentEntry.table_name,
              currentEntry.entity_id,
              currentEntry.payload ?? '',
              conflictServerRowStr,
              conflictNow,
            ]
          );

          await db.runAsync(
            `UPDATE ${currentEntry.table_name} SET sync_state = 'conflict' WHERE id = ?;`,
            [currentEntry.entity_id]
          );

          await db.runAsync(
            "UPDATE outbox SET status = 'blocked', last_error = 'Version conflict with server' WHERE sequence = ?;",
            [currentEntry.sequence]
          );

          await db.runAsync(
            `UPDATE outbox SET status = 'blocked', last_error = 'Preceding mutation in conflict'
             WHERE table_name = ? AND entity_id = ? AND status = 'pending';`,
            [currentEntry.table_name, currentEntry.entity_id]
          );

          if (currentEntry.table_name === 'categories') {
            await blockDependentTransactions(
              db,
              currentEntry.entity_id,
              currentEntry.mutation_id,
              'in conflict'
            );
          }
        });

        blockedCount++;
      } else if (result.status === 'not_found') {
        // Rule: status 'not_found': record a sync_errors row, mark 'failed'
        await db.withTransactionAsync(async () => {
          const now = new Date().toISOString();
          await db.runAsync(
            `INSERT INTO sync_errors (
               mutation_id, table_name, entity_id, code, message, created_at
             ) VALUES (?, ?, ?, 'not_found', 'Entity not found on server', ?);`,
            [currentEntry.mutation_id, currentEntry.table_name, currentEntry.entity_id, now]
          );

          await db.runAsync(
            "UPDATE outbox SET status = 'failed', last_error = 'Entity not found on server' WHERE sequence = ?;",
            [currentEntry.sequence]
          );

          if (currentEntry.table_name === 'categories') {
            await blockDependentTransactions(
              db,
              currentEntry.entity_id,
              currentEntry.mutation_id,
              'not found'
            );
          }
        });

        failedCount++;
      }
    } catch (err: unknown) {
      const classification =
        err instanceof SyncRemoteError ? err.classification : classifyRemoteError(err);

      if (classification === 'network') {
        // Rule: network error: set the entry back to 'pending', increment attempt_count,
        // set next_attempt_at with exponential backoff and jitter (capped at 5 minutes),
        // STOP the run, and keep all data. A network failure must never lose or alter a mutation.
        const nextAttemptCount = currentEntry.attempt_count + 1;
        const delayMs = calculateBackoffWithJitter(nextAttemptCount);
        const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
        const errorMsg = err instanceof Error ? err.message : 'Network error';

        await db.runAsync(
          `UPDATE outbox
           SET status = 'pending', attempt_count = ?, next_attempt_at = ?, last_error = ?
           WHERE sequence = ?;`,
          [nextAttemptCount, nextAttemptAt, errorMsg, currentEntry.sequence]
        );

        return {
          pushed: pushedCount,
          failed: failedCount,
          blocked: blockedCount,
          stoppedBecause: 'network_error',
        };
      }

      if (classification === 'auth') {
        // Rule: auth error: set syncPaused reason to 'session_expired' through the existing mechanism,
        // keep the entry pending, STOP the run.
        await db.runAsync(
          "UPDATE outbox SET status = 'pending', last_error = 'Session expired' WHERE sequence = ?;",
          [currentEntry.sequence]
        );

        setGlobalSyncPaused('session_expired');

        return {
          pushed: pushedCount,
          failed: failedCount,
          blocked: blockedCount,
          stoppedBecause: 'auth_error',
        };
      }

      // Rule: server error (validation, constraint): record sync_errors,
      // mark 'failed' with last_error, continue with the others.
      const serverErrMsg = err instanceof Error ? err.message : 'Server error';
      const now = new Date().toISOString();

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO sync_errors (
             mutation_id, table_name, entity_id, code, message, created_at
           ) VALUES (?, ?, ?, 'server_error', ?, ?);`,
          [currentEntry.mutation_id, currentEntry.table_name, currentEntry.entity_id, serverErrMsg, now]
        );

        await db.runAsync(
          "UPDATE outbox SET status = 'failed', last_error = ? WHERE sequence = ?;",
          [serverErrMsg, currentEntry.sequence]
        );

        if (currentEntry.table_name === 'categories') {
          await blockDependentTransactions(
            db,
            currentEntry.entity_id,
            currentEntry.mutation_id,
            'failed with server error'
          );
        }
      });

      failedCount++;
    }
  }

  return {
    pushed: pushedCount,
    failed: failedCount,
    blocked: blockedCount,
    stoppedBecause: null,
  };
}
