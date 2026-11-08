import { DbLike, OutboxRow } from '@/db/types';
import { canSync } from '@/db/database';
import { emitTableChange } from '@/db/events';
import { getSyncPausedReason } from './state';
import { SyncRemote, defaultSyncRemote, SyncRemoteError, classifyRemoteError } from './remote';
import { pushOutbox } from './push';
import { pullChanges } from './pull';

export type SyncStoppedReason =
  | 'not_authorized'
  | 'paused'
  | 'network_error'
  | 'auth_error'
  | 'unexpected_error';

export interface SyncSummary {
  pushed: number;
  failed: number;
  blocked: number;
  pulled: number;
  stoppedBecause?: SyncStoppedReason | null;
}

export interface SyncCounts {
  pending: number;
  blocked: number;
  failed: number;
}

/**
 * Returns counts of outbox mutations grouped by status for UI indicators.
 */
export async function getSyncCounts(db: DbLike): Promise<SyncCounts> {
  try {
    const rows = await db.getAllAsync<{ status: string; count: number }>(
      "SELECT status, count(*) as count FROM outbox WHERE status IN ('pending', 'blocked', 'failed') GROUP BY status;"
    );

    let pending = 0;
    let blocked = 0;
    let failed = 0;

    for (const r of rows) {
      if (r.status === 'pending') pending = r.count;
      if (r.status === 'blocked') blocked = r.count;
      if (r.status === 'failed') failed = r.count;
    }

    return { pending, blocked, failed };
  } catch {
    return { pending: 0, blocked: 0, failed: 0 };
  }
}

/**
 * Resets entries left in 'in_flight' status by a killed or restarted app back to 'pending'.
 * Preserves the original mutation_id for deduplication.
 */
export async function resetInFlightEntries(db: DbLike): Promise<number> {
  const res = await db.runAsync(
    "UPDATE outbox SET status = 'pending' WHERE status = 'in_flight';"
  );
  if (res.changes > 0) {
    emitTableChange('outbox');
  }
  return res.changes;
}

/**
 * Unblocks blocked transaction outbox entries if their referenced category has been
 * synced and is now valid and active.
 */
async function unblockEligibleTransactions(db: DbLike): Promise<number> {
  const blockedEntries = await db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE table_name = 'transactions' AND status = 'blocked';"
  );

  let unblockedCount = 0;

  for (const entry of blockedEntries) {
    let categoryId: string | null = null;
    if (entry.payload) {
      try {
        const parsed = JSON.parse(entry.payload) as { category_id?: string };
        categoryId = parsed.category_id ?? null;
      } catch {
        // Ignore parse error
      }
    }

    if (!categoryId) {
      const localTx = await db.getFirstAsync<{ category_id: string }>(
        'SELECT category_id FROM transactions WHERE id = ?;',
        [entry.entity_id]
      );
      categoryId = localTx?.category_id ?? null;
    }

    if (categoryId) {
      const category = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL;',
        [categoryId]
      );

      if (category) {
        const catBlocked = await db.getFirstAsync<{ count: number }>(
          "SELECT count(*) as count FROM outbox WHERE table_name = 'categories' AND entity_id = ? AND status = 'blocked';",
          [categoryId]
        );

        if ((catBlocked?.count ?? 0) === 0) {
          await db.runAsync(
            "UPDATE outbox SET status = 'pending', last_error = NULL WHERE sequence = ?;",
            [entry.sequence]
          );
          unblockedCount++;
        }
      }
    }
  }

  return unblockedCount;
}

let activeSyncPromise: Promise<SyncSummary> | null = null;
let startupResetCompleted = false;

/**
 * Reset startup reset state for test isolations.
 */
export function _resetStartupStateForTesting(): void {
  startupResetCompleted = false;
  activeSyncPromise = null;
}

/**
 * Internal execution pipeline for sync.
 */
async function executeSync(
  db: DbLike,
  userId: string,
  remote: SyncRemote
): Promise<SyncSummary> {
  // 1. Return early if canSync(db, userId) is false
  const authorized = await canSync(db, userId);
  if (!authorized) {
    if (__DEV__) {
      console.log('[Sync] Synchronization skipped: unauthorized account partition mismatch');
    }
    return {
      pushed: 0,
      failed: 0,
      blocked: 0,
      pulled: 0,
      stoppedBecause: 'not_authorized',
    };
  }

  // 2. Return early if syncPaused is set
  const pauseReason = getSyncPausedReason();
  if (pauseReason !== null) {
    if (__DEV__) {
      console.log(`[Sync] Synchronization skipped: sync is paused (${pauseReason})`);
    }
    return {
      pushed: 0,
      failed: 0,
      blocked: 0,
      pulled: 0,
      stoppedBecause: 'paused',
    };
  }

  // 3. At startup (before the first push) reset entries left 'in_flight' back to 'pending'
  if (!startupResetCompleted) {
    await resetInFlightEntries(db);
    startupResetCompleted = true;
  }

  // 4. Initial Push run
  const push1 = await pushOutbox(db, remote);
  let totalPushed = push1.pushed;
  let totalFailed = push1.failed;
  let totalBlocked = push1.blocked;

  if (push1.stoppedBecause) {
    if (__DEV__) {
      console.log(`[Sync] Stopped during initial push: pushed=${totalPushed}, failed=${totalFailed}, blocked=${totalBlocked}`);
    }
    return {
      pushed: totalPushed,
      failed: totalFailed,
      blocked: totalBlocked,
      pulled: 0,
      stoppedBecause: push1.stoppedBecause,
    };
  }

  // 5. Pull changes
  let pullPulled = 0;
  try {
    const pullResult = await pullChanges(db, remote);
    pullPulled = pullResult.pulled;
  } catch (err: unknown) {
    const classification =
      err instanceof SyncRemoteError ? err.classification : classifyRemoteError(err);

    if (classification === 'network') {
      return {
        pushed: totalPushed,
        failed: totalFailed,
        blocked: totalBlocked,
        pulled: pullPulled,
        stoppedBecause: 'network_error',
      };
    }

    if (classification === 'auth') {
      return {
        pushed: totalPushed,
        failed: totalFailed,
        blocked: totalBlocked,
        pulled: pullPulled,
        stoppedBecause: 'auth_error',
      };
    }
  }

  // 6. Push again once if pull changed anything that unblocks entries
  let unblocked = 0;
  if (pullPulled > 0) {
    unblocked = await unblockEligibleTransactions(db);
  }

  if (pullPulled > 0 || unblocked > 0) {
    const push2 = await pushOutbox(db, remote);
    totalPushed += push2.pushed;
    totalFailed += push2.failed;
    totalBlocked = push2.blocked; // Take latest blocked state

    if (push2.stoppedBecause) {
      return {
        pushed: totalPushed,
        failed: totalFailed,
        blocked: totalBlocked,
        pulled: pullPulled,
        stoppedBecause: push2.stoppedBecause,
      };
    }
  }

  if (__DEV__) {
    // Rule: never log row data, amounts, notes, ids or tokens; log only counts in __DEV__.
    console.log(
      `[Sync] Summary: pushed=${totalPushed}, pulled=${pullPulled}, blocked=${totalBlocked}, failed=${totalFailed}`
    );
  }

  return {
    pushed: totalPushed,
    failed: totalFailed,
    blocked: totalBlocked,
    pulled: pullPulled,
    stoppedBecause: null,
  };
}

/**
 * Runs end-to-end synchronization for categories and transactions.
 * Enforces single-flight concurrency, account isolation check, and safe error boundary.
 * NEVER throws an uncaught exception out of runSync.
 */
export function runSync(
  db: DbLike,
  userId: string,
  remote: SyncRemote = defaultSyncRemote
): Promise<SyncSummary> {
  // Single-flight: if a sync is already running, return the same promise
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    try {
      return await executeSync(db, userId, remote);
    } catch {
      // NEVER throw out of runSync
      return {
        pushed: 0,
        failed: 0,
        blocked: 0,
        pulled: 0,
        stoppedBecause: 'unexpected_error',
      };
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
