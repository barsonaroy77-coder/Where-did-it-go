import { openDatabaseAsync, deleteDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from './migrate';
import { assertDatabaseOwner } from './database';
import {
  createCategory,
  createTransaction,
  getOutboxEntries,
  listTransactionsForMonth,
  softDeleteTransaction,
  restoreTransaction,
} from './repositories';
import { generateClientUuid } from './repositories/uuid';

export interface SmokeTestResult {
  ok: boolean;
  step: string;
}

/**
 * Runs a device smoke test on real expo-sqlite using a throwaway database.
 * Strictly available and run in __DEV__ only.
 * Uses a SEPARATE throwaway database file with a random name and a fake user id,
 * never the user's real database.
 *
 * Steps:
 * 1. run migrations
 * 2. create a category and a transaction through the repositories
 * 3. confirm the outbox has 2 entries
 * 4. list the month
 * 5. soft delete and restore
 * 6. confirm composite foreign keys reject a transaction using a nonexistent category
 * 7. delete the throwaway database file
 *
 * Logs ONLY "smoke test passed" or the failing step name. No data or IDs in the logs.
 */
export async function runDbSmokeTest(): Promise<SmokeTestResult> {
  const throwawayDbName = `throwaway_smoke_${Date.now()}_${Math.floor(Math.random() * 1000000)}.db`;
  const fakeUserId = generateClientUuid();
  let db: SQLiteDatabase | null = null;
  let currentStep = 'run migrations';

  try {
    // Step 1: run migrations
    currentStep = 'run migrations';
    db = await openDatabaseAsync(throwawayDbName);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
    await runMigrations(db);
    await assertDatabaseOwner(db, fakeUserId);

    // Step 2: create a category and a transaction through the repositories
    currentStep = 'create a category and a transaction through the repositories';
    const catRes = await createCategory(
      db,
      {
        name: 'Smoke Category',
        icon: 'tag',
        color: '#000000',
        type: 'expense',
      },
      { userId: fakeUserId }
    );
    if (!catRes.ok || !catRes.value) {
      throw new Error('create category failed');
    }

    const txRes = await createTransaction(
      db,
      {
        type: 'expense',
        amount: 2500,
        category_id: catRes.value.id,
        date: '2026-03-15',
        note: 'Smoke test transaction',
      },
      { userId: fakeUserId }
    );
    if (!txRes.ok || !txRes.value) {
      throw new Error('create transaction failed');
    }

    // Step 3: confirm the outbox has 2 entries
    currentStep = 'confirm the outbox has 2 entries';
    const outbox = await getOutboxEntries(db);
    if (outbox.length !== 2) {
      throw new Error(`expected 2 outbox entries, found ${outbox.length}`);
    }

    // Step 4: list the month
    currentStep = 'list the month';
    const monthTransactions = await listTransactionsForMonth(db, '2026-03');
    if (monthTransactions.length !== 1 || monthTransactions[0].id !== txRes.value.id) {
      throw new Error('list the month failed');
    }

    // Step 5: soft delete and restore
    currentStep = 'soft delete and restore';

    // Mark the created transaction as synced before deleting so coalescing does not drop the row
    await db.runAsync(
      "UPDATE transactions SET sync_state = 'synced', version = 1 WHERE id = ?;",
      [txRes.value.id]
    );
    await db.runAsync(
      'DELETE FROM outbox WHERE entity_id = ?;',
      [txRes.value.id]
    );

    const delRes = await softDeleteTransaction(db, txRes.value.id);
    if (!delRes.ok) {
      throw new Error('soft delete failed');
    }
    const afterDelete = await listTransactionsForMonth(db, '2026-03');
    if (afterDelete.length !== 0) {
      throw new Error('transaction was not excluded after soft delete');
    }

    const restoreRes = await restoreTransaction(db, txRes.value.id);
    if (!restoreRes.ok) {
      throw new Error('restore failed');
    }
    if (restoreRes.value.deleted_at !== null) {
      throw new Error('deleted_at was not cleared');
    }
    const deleteOutboxEntries = await db.getAllAsync(
      "SELECT * FROM outbox WHERE entity_id = ? AND op = 'delete';",
      [txRes.value.id]
    );
    if (deleteOutboxEntries.length !== 0) {
      throw new Error('delete outbox entry was not removed after restore');
    }
    const afterRestore = await listTransactionsForMonth(db, '2026-03');
    if (afterRestore.length !== 1) {
      throw new Error('transaction was not restored to month listing');
    }

    // Second restore attempt after marking the entry in_flight returns the "too late to undo" error
    const delRes2 = await softDeleteTransaction(db, txRes.value.id);
    if (!delRes2.ok) {
      throw new Error('second soft delete failed');
    }
    await db.runAsync(
      "UPDATE outbox SET status = 'in_flight' WHERE entity_id = ? AND op = 'delete';",
      [txRes.value.id]
    );
    const secondRestoreRes = await restoreTransaction(db, txRes.value.id);
    if (secondRestoreRes.ok || secondRestoreRes.error !== 'Too late to undo') {
      throw new Error('second restore attempt did not return too late to undo error');
    }

    // Step 6: confirm composite foreign keys reject a transaction using a nonexistent category
    currentStep = 'confirm composite foreign keys reject a transaction using a nonexistent category';
    let rejected = false;
    try {
      await db.runAsync(
        `INSERT INTO transactions (
          id, user_id, type, amount, category_id, note, date,
          recurring_id, occurrence_date, version, change_seq,
          created_at, updated_at, deleted_at, local_revision, sync_state
        ) VALUES (?, ?, 'expense', 1500, ?, NULL, '2026-03-15', NULL, NULL, 1, 0, '2026-03-15', '2026-03-15', NULL, 1, 'pending');`,
        [generateClientUuid(), fakeUserId, generateClientUuid()]
      );
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error('composite foreign key constraint was not enforced');
    }

    // Step 7: delete the throwaway database file
    currentStep = 'delete the throwaway database file';
    await db.closeAsync();
    db = null;
    await deleteDatabaseAsync(throwawayDbName);

    // Success log: Log only "smoke test passed" (no data, no ids)
    console.log('smoke test passed');
    return { ok: true, step: 'smoke test passed' };
  } catch (err) {
    // Failing log: Log only the failing step name (no data, no ids)
    console.error(currentStep);

    // Clean up resources safely
    if (db) {
      try {
        await db.closeAsync();
      } catch {
        // Silently ignore cleanup errors
      }
      try {
        await deleteDatabaseAsync(throwawayDbName);
      } catch {
        // Silently ignore cleanup errors
      }
    }

    return { ok: false, step: currentStep };
  }
}
