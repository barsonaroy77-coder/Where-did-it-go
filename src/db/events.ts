/**
 * DATA REFRESH EVENT EMITTER (Phase 5 Part 1)
 *
 * Evaluation of expo-sqlite change-listener API:
 * expo-sqlite provides `addDatabaseChangeListener` backed by the native `sqlite3_update_hook`.
 * However, we evaluated it and determined that an in-memory event emitter is required because:
 * 1. `addDatabaseChangeListener` relies on native iOS/Android bindings that do not run in Node/Jest
 *    (such as our WASM SqlJsAdapter test environment).
 * 2. `sqlite3_update_hook` triggers synchronously on each statement execution inside transactions.
 *    Consequently, it fires even if the transaction is subsequently ROLLED BACK upon error.
 * 3. Our offline-first database contracts strictly require notifications ONLY AFTER transactions
 *    COMMIT, never on rollback or mid-transaction.
 *
 * This module provides an in-memory transactional emitter (`src/db/events.ts`) and a
 * transaction wrapper (`withTransactionAndNotify`). Repositories, the sync engine pull step,
 * and outbox mutations publish table changed events strictly after transactions commit.
 */

import { DbLike } from './types';

export type TableChangeListener = (changedTables: string[]) => void;

interface Subscription {
  tables: Set<string>;
  listener: TableChangeListener;
}

const subscriptions = new Set<Subscription>();

/**
 * Emits a change event for the given table(s).
 * Notifies all active subscribers that registered interest in at least one of the tables.
 */
export function emitTableChange(tables: string | string[]): void {
  const tableList = Array.isArray(tables) ? tables : [tables];
  if (tableList.length === 0) {
    return;
  }

  const tableSet = new Set(tableList);

  for (const sub of subscriptions) {
    const matched = tableList.filter((t) => sub.tables.has(t));
    if (matched.length > 0) {
      try {
        sub.listener(matched);
      } catch (err) {
        console.error('[db/events] Error inside table change listener:', err);
      }
    }
  }
}

/**
 * Subscribes to changes on specified tables.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeTableChange(
  tables: string[],
  listener: TableChangeListener
): () => void {
  const sub: Subscription = {
    tables: new Set(tables),
    listener,
  };

  subscriptions.add(sub);

  return () => {
    subscriptions.delete(sub);
  };
}

/**
 * Executes a transaction and emits a change event for the specified tables
 * ONLY after the transaction commits successfully.
 * If the transaction rolls back or throws, NO event is emitted.
 */
export async function withTransactionAndNotify(
  db: DbLike,
  tables: string[],
  task: () => Promise<void>
): Promise<void> {
  await db.withTransactionAsync(task);
  emitTableChange(tables);
}

/**
 * Test utility: clears all registered subscriptions.
 */
export function _resetSubscriptionsForTesting(): void {
  subscriptions.clear();
}
