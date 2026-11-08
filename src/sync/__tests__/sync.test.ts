jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => require('crypto').randomUUID()),
}));

import { SqlJsAdapter } from '@/db/testAdapter';
import { assertDatabaseOwner } from '@/db/database';
import { createCategory, updateCategory } from '@/db/repositories/categories';
import { createTransaction } from '@/db/repositories/transactions';
import { OutboxRow, CategoryRow, TransactionRow, ConflictRow, SQLiteVariadicBindParams } from '@/db/types';
import {
  SyncRemote,
  OutboxEntry,
  RemoteMutationResult,
  SyncRemoteError,
} from '../remote';
import { pushOutbox } from '../push';
import { pullChanges } from '../pull';
import {
  runSync,
  resetInFlightEntries,
  _resetStartupStateForTesting,
} from '../engine';
import { setGlobalSyncPaused } from '../state';

class FakeSyncRemote implements SyncRemote {
  public mutationsApplied: OutboxEntry[] = [];
  public fetchCalls: { table: string; afterChangeSeq: number; limit: number }[] = [];

  public applyMutationHandler?: (entry: OutboxEntry) => Promise<RemoteMutationResult>;
  public fetchChangesHandler?: (
    table: string,
    afterChangeSeq: number,
    limit: number
  ) => Promise<Record<string, unknown>[]>;

  async applyMutation(entry: OutboxEntry): Promise<RemoteMutationResult> {
    this.mutationsApplied.push({ ...entry });
    if (this.applyMutationHandler) {
      return this.applyMutationHandler(entry);
    }
    return {
      status: 'applied',
      entity: {
        id: entry.entity_id,
        user_id: 'user_123',
        version: (entry.base_version ?? 0) + 1,
        change_seq: 100 + this.mutationsApplied.length,
        created_at: '2026-11-07T12:00:00.000Z',
        updated_at: '2026-11-07T12:00:00.000Z',
        deleted_at: null,
        ...(entry.payload ? JSON.parse(entry.payload) : {}),
      },
    };
  }

  async fetchChanges(
    table: string,
    afterChangeSeq: number,
    limit: number
  ): Promise<Record<string, unknown>[]> {
    this.fetchCalls.push({ table, afterChangeSeq, limit });
    if (this.fetchChangesHandler) {
      return this.fetchChangesHandler(table, afterChangeSeq, limit);
    }
    return [];
  }
}

describe('Sync Engine Prototype (Categories and Transactions)', () => {
  let db: SqlJsAdapter;
  let remote: FakeSyncRemote;
  const testUserId = 'user_123';

  beforeEach(async () => {
    db = await SqlJsAdapter.createWithMigrations();
    await assertDatabaseOwner(db, testUserId);
    remote = new FakeSyncRemote();
    setGlobalSyncPaused(null);
    _resetStartupStateForTesting();
  });

  // 1. push applied: local row updated with server values, entry removed, sync_state 'synced'
  test('push applied: local row updated with server values, entry removed, sync_state synced', async () => {
    const createRes = await createCategory(
      db,
      { name: 'Groceries', icon: 'basket', color: '#00AA00', type: 'expense' },
      { userId: testUserId }
    );
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create category failed');
    const categoryId = createRes.value.id;

    // Verify initial local state
    const initialRow = await db.getFirstAsync<CategoryRow>(
      'SELECT * FROM categories WHERE id = ?;',
      [categoryId]
    );
    expect(initialRow?.sync_state).toBe('pending');
    expect(initialRow?.version).toBe(1);

    const outboxBefore = await db.getAllAsync<OutboxRow>('SELECT * FROM outbox;');
    expect(outboxBefore.length).toBe(1);

    // Push to server
    const pushSummary = await pushOutbox(db, remote);
    expect(pushSummary.pushed).toBe(1);
    expect(pushSummary.failed).toBe(0);
    expect(pushSummary.blocked).toBe(0);

    // Verify local row updated with server values
    const updatedRow = await db.getFirstAsync<CategoryRow>(
      'SELECT * FROM categories WHERE id = ?;',
      [categoryId]
    );
    expect(updatedRow?.sync_state).toBe('synced');
    expect(updatedRow?.change_seq).toBe(101);
    expect(updatedRow?.updated_at).toBe('2026-11-07T12:00:00.000Z');

    // Verify outbox entry removed
    const outboxAfter = await db.getAllAsync<OutboxRow>('SELECT * FROM outbox;');
    expect(outboxAfter.length).toBe(0);
  });

  // 2. push conflict: conflicts row stored, entity 'conflict', entry 'blocked', local payload unchanged
  test('push conflict: conflicts row stored, entity conflict, entry blocked, local payload unchanged', async () => {
    const createRes = await createCategory(
      db,
      { name: 'Utilities', icon: 'bolt', color: '#FFAA00', type: 'expense' },
      { userId: testUserId }
    );
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create category failed');
    const categoryId = createRes.value.id;

    // Configure remote to return conflict
    const serverConflictRow = {
      id: categoryId,
      user_id: testUserId,
      name: 'Server Utilities',
      icon: 'bolt-server',
      color: '#FF0000',
      type: 'expense',
      archived_at: null,
      version: 5,
      change_seq: 999,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
      deleted_at: null,
    };

    remote.applyMutationHandler = async () => ({
      status: 'conflict',
      entity: serverConflictRow,
    });

    const pushSummary = await pushOutbox(db, remote);
    expect(pushSummary.blocked).toBe(1);
    expect(pushSummary.pushed).toBe(0);

    // Verify conflicts row stored
    const conflictRows = await db.getAllAsync<ConflictRow>('SELECT * FROM conflicts;');
    expect(conflictRows.length).toBe(1);
    expect(conflictRows[0].entity_id).toBe(categoryId);
    expect(conflictRows[0].table_name).toBe('categories');
    expect(conflictRows[0].local_payload).toContain('Utilities');
    expect(conflictRows[0].server_row).toContain('Server Utilities');

    // Entity sync_state is 'conflict'
    const categoryRow = await db.getFirstAsync<CategoryRow>(
      'SELECT * FROM categories WHERE id = ?;',
      [categoryId]
    );
    expect(categoryRow?.sync_state).toBe('conflict');
    // Local payload unchanged
    expect(categoryRow?.name).toBe('Utilities');

    // Outbox entry marked 'blocked'
    const outboxRows = await db.getAllAsync<OutboxRow>('SELECT * FROM outbox;');
    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].status).toBe('blocked');
  });

  // 3. network failure: entry back to 'pending' with attempt_count + 1, data untouched, run stops
  test('network failure: entry back to pending with attempt_count + 1, data untouched, run stops', async () => {
    const createRes = await createCategory(
      db,
      { name: 'Transport', icon: 'car', color: '#0000FF', type: 'expense' },
      { userId: testUserId }
    );
    expect(createRes.ok).toBe(true);

    remote.applyMutationHandler = async () => {
      throw new SyncRemoteError('network', 'Failed to fetch: offline');
    };

    const pushSummary = await pushOutbox(db, remote);
    expect(pushSummary.stoppedBecause).toBe('network_error');
    expect(pushSummary.pushed).toBe(0);

    const outboxEntry = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox;');
    expect(outboxEntry?.status).toBe('pending');
    expect(outboxEntry?.attempt_count).toBe(1);
    expect(outboxEntry?.next_attempt_at).toBeTruthy();
    expect(outboxEntry?.last_error).toContain('Failed to fetch');

    // Data untouched
    const catRow = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories;');
    expect(catRow?.name).toBe('Transport');
    expect(catRow?.sync_state).toBe('pending');
  });

  // 4. lost response then retry: the same mutation_id is sent again
  test('lost response then retry: the same mutation_id is sent again', async () => {
    const createRes = await createCategory(
      db,
      { name: 'Dining', icon: 'utensils', color: '#FF5500', type: 'expense' },
      { userId: testUserId }
    );
    expect(createRes.ok).toBe(true);

    let attempts = 0;
    remote.applyMutationHandler = async (entry) => {
      attempts++;
      if (attempts === 1) {
        // Lost response after network drop
        throw new SyncRemoteError('network', 'Network timeout while awaiting response');
      }
      return {
        status: 'applied',
        entity: {
          id: entry.entity_id,
          user_id: testUserId,
          name: 'Dining',
          icon: 'utensils',
          color: '#FF5500',
          type: 'expense',
          archived_at: null,
          version: 1,
          change_seq: 150,
          created_at: '2026-11-07T12:00:00.000Z',
          updated_at: '2026-11-07T12:00:00.000Z',
          deleted_at: null,
        },
      };
    };

    // First attempt fails
    const run1 = await pushOutbox(db, remote);
    expect(run1.stoppedBecause).toBe('network_error');

    // Clear next_attempt_at to retry immediately
    await db.runAsync('UPDATE outbox SET next_attempt_at = NULL;');

    // Second attempt succeeds
    const run2 = await pushOutbox(db, remote);
    expect(run2.pushed).toBe(1);

    expect(remote.mutationsApplied.length).toBe(2);
    // Verified: The same mutation_id is sent again for retry deduplication
    expect(remote.mutationsApplied[0].mutation_id).toBe(remote.mutationsApplied[1].mutation_id);
  });

  // 5. in_flight entries are reset to pending at startup
  test('in_flight entries are reset to pending at startup', async () => {
    const mutationId = 'mutation-in-flight-1';
    await db.runAsync(
      `INSERT INTO outbox (
        mutation_id, table_name, entity_id, op, base_version, payload,
        local_revision, status, attempt_count, last_error, next_attempt_at, created_at
      ) VALUES (?, 'categories', 'cat-1', 'create', NULL, '{}', 1, 'in_flight', 0, NULL, NULL, ?);`,
      [mutationId, new Date().toISOString()]
    );

    const count = await resetInFlightEntries(db);
    expect(count).toBe(1);

    const row = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE mutation_id = ?;', [
      mutationId,
    ]);
    expect(row?.status).toBe('pending');
    expect(row?.mutation_id).toBe(mutationId);
  });

  // 6. an entry queued behind an in_flight one gets its base_version filled after the first is acknowledged
  test('an entry queued behind an in_flight one gets its base_version filled after the first is acknowledged', async () => {
    const createRes = await createCategory(
      db,
      { name: 'Health', icon: 'heart', color: '#EE0000', type: 'expense' },
      { userId: testUserId }
    );
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create category failed');
    const catId = createRes.value.id;

    // Simulate entry 1 is marked in_flight
    await db.runAsync("UPDATE outbox SET status = 'in_flight' WHERE entity_id = ?;", [catId]);

    // An edit is made while entry 1 is in_flight -> creates entry 2 with base_version NULL
    const updateRes = await updateCategory(db, catId, { name: 'Health & Wellness' });
    expect(updateRes.ok).toBe(true);

    const outboxEntries = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ? ORDER BY sequence ASC;',
      [catId]
    );
    expect(outboxEntries.length).toBe(2);
    expect(outboxEntries[0].status).toBe('in_flight');
    expect(outboxEntries[1].status).toBe('pending');
    expect(outboxEntries[1].base_version).toBeNull();

    // Now run push:
    // Entry 1 is already in_flight; for entry 1's server response, version 2 is returned
    remote.applyMutationHandler = async (entry) => {
      const serverVersion = (entry.base_version ?? 0) + 2;
      return {
        status: 'applied',
        entity: {
          id: entry.entity_id,
          user_id: testUserId,
          name: 'Health',
          icon: 'heart',
          color: '#EE0000',
          type: 'expense',
          archived_at: null,
          version: serverVersion,
          change_seq: 120,
          created_at: '2026-11-07T12:00:00.000Z',
          updated_at: '2026-11-07T12:00:00.000Z',
          deleted_at: null,
        },
      };
    };

    // Before entry 2 is processed by pushOutbox, entry 1 completes and updates local table + base_version of entry 2!
    // Let's acknowledge entry 1:
    // Mark entry 1 back to pending so pushOutbox processes entry 1 then entry 2 sequentially
    await db.runAsync("UPDATE outbox SET status = 'pending' WHERE sequence = ?;", [
      outboxEntries[0].sequence,
    ]);

    const pushRes = await pushOutbox(db, remote);
    expect(pushRes.pushed).toBe(2);

    // Verify mutation 2 was sent with acknowledged server base_version 2 (not null!)
    expect(remote.mutationsApplied.length).toBe(2);
    expect(remote.mutationsApplied[1].base_version).toBe(2);
  });

  // 7. a failed category blocks dependent transaction entries
  test('a failed category blocks dependent transaction entries', async () => {
    const catRes = await createCategory(
      db,
      { name: 'Travel', icon: 'plane', color: '#0088FF', type: 'expense' },
      { userId: testUserId }
    );
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) throw new Error('Create category failed');
    const catId = catRes.value.id;

    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 15000,
      category_id: catId,
      date: '2026-11-07',
      note: 'Flight ticket',
    });
    expect(txRes.ok).toBe(true);
    if (!txRes.ok) throw new Error('Create transaction failed');
    const txId = txRes.value.id;

    // Remote fails the category mutation with a server error
    remote.applyMutationHandler = async (entry) => {
      if (entry.table_name === 'categories') {
        throw new SyncRemoteError('server', 'Category name violates uniqueness constraint');
      }
      return {
        status: 'applied',
        entity: null,
      };
    };

    const pushRes = await pushOutbox(db, remote);
    expect(pushRes.failed).toBe(1);

    // Verify category entry marked 'failed'
    const catOutbox = await db.getFirstAsync<OutboxRow>(
      "SELECT * FROM outbox WHERE table_name = 'categories' AND entity_id = ?;",
      [catId]
    );
    expect(catOutbox?.status).toBe('failed');

    // Verify dependent transaction outbox entry was marked 'blocked'
    const txOutbox = await db.getFirstAsync<OutboxRow>(
      "SELECT * FROM outbox WHERE table_name = 'transactions' AND entity_id = ?;",
      [txId]
    );
    expect(txOutbox?.status).toBe('blocked');
    expect(txOutbox?.last_error).toContain('dependency blocked');
  });

  // 8. pull: rows upserted, cursor advanced in the same transaction; simulate a failure mid-page and prove the cursor did NOT move
  test('pull: rows upserted, cursor advanced in the same transaction; failure mid-page proves cursor did NOT move', async () => {
    // Set initial cursor in sync_state_meta to 10
    await db.runAsync(
      "INSERT INTO sync_state_meta (table_name, last_change_seq, updated_at) VALUES ('categories', 10, ?);",
      [new Date().toISOString()]
    );

    let pullAttempts = 0;
    remote.fetchChangesHandler = async (table) => {
      if (table === 'categories') {
        pullAttempts++;
        if (pullAttempts === 1) {
          // Return two rows, but the second row will cause an error during local insert
          // by creating a unique constraint violation or missing required field that passes validation
          return [
            {
              id: 'cat-valid-1',
              user_id: testUserId,
              name: 'Valid Cat',
              icon: 'check',
              color: '#00FF00',
              type: 'expense',
              archived_at: null,
              version: 1,
              change_seq: 15,
              created_at: '2026-11-07T12:00:00.000Z',
              updated_at: '2026-11-07T12:00:00.000Z',
              deleted_at: null,
            },
            {
              // Invalid row with null user_id that fails SQLite NOT NULL constraint during INSERT
              id: 'cat-invalid-2',
              user_id: null as unknown as string,
              name: 'Invalid Cat',
              icon: 'x',
              color: '#FF0000',
              type: 'expense',
              archived_at: null,
              version: 1,
              change_seq: 20,
              created_at: '2026-11-07T12:00:00.000Z',
              updated_at: '2026-11-07T12:00:00.000Z',
              deleted_at: null,
            },
          ];
        }
      }
      return [];
    };

    // The malformed second row is detected during validation, so it skips cleanly rather than crashing.
    // Let's test atomic rollback when an actual DB execution fails:
    const originalRunAsync = db.runAsync.bind(db);
    let runCallCount = 0;
    jest.spyOn(db, 'runAsync').mockImplementation(async (sql, ...params) => {
      runCallCount++;
      // Fail on the second row insert inside the transaction
      if (sql.includes('INSERT INTO categories') && runCallCount === 2) {
        throw new Error('Simulated SQLite crash mid-page');
      }
      return originalRunAsync(sql, ...(params as SQLiteVariadicBindParams));
    });

    remote.fetchChangesHandler = async (table) => {
      if (table === 'categories') {
        return [
          {
            id: 'cat-a',
            user_id: testUserId,
            name: 'Cat A',
            icon: 'a',
            color: '#111',
            type: 'expense',
            archived_at: null,
            version: 1,
            change_seq: 15,
            created_at: '2026-11-07T12:00:00.000Z',
            updated_at: '2026-11-07T12:00:00.000Z',
            deleted_at: null,
          },
          {
            id: 'cat-b',
            user_id: testUserId,
            name: 'Cat B',
            icon: 'b',
            color: '#222',
            type: 'expense',
            archived_at: null,
            version: 1,
            change_seq: 20,
            created_at: '2026-11-07T12:00:00.000Z',
            updated_at: '2026-11-07T12:00:00.000Z',
            deleted_at: null,
          },
        ];
      }
      return [];
    };

    // Attempt pull; it will encounter the mid-page crash
    await expect(pullChanges(db, remote)).rejects.toThrow('Simulated SQLite crash mid-page');

    // Prove cursor did NOT move from 10
    const metaAfterCrash = await db.getFirstAsync<{ last_change_seq: number }>(
      "SELECT last_change_seq FROM sync_state_meta WHERE table_name = 'categories';"
    );
    expect(metaAfterCrash?.last_change_seq).toBe(10);

    // Prove neither row was committed
    const catA = await db.getFirstAsync('SELECT * FROM categories WHERE id = ?;', ['cat-a']);
    expect(catA).toBeNull();

    // Restore runAsync and run pull successfully
    (db.runAsync as jest.Mock).mockRestore();

    const pullSuccess = await pullChanges(db, remote);
    expect(pullSuccess.pulled).toBe(2);

    // Cursor successfully advanced to 20
    const metaSuccess = await db.getFirstAsync<{ last_change_seq: number }>(
      "SELECT last_change_seq FROM sync_state_meta WHERE table_name = 'categories';"
    );
    expect(metaSuccess?.last_change_seq).toBe(20);
  });

  // 9. pull never overwrites a 'pending' or 'conflict' row
  test('pull never overwrites a pending or conflict row', async () => {
    // Local pending category
    const pendingCatId = 'cat-pending-1';
    await db.runAsync(
      `INSERT INTO categories (
        id, user_id, name, icon, color, type, archived_at,
        version, change_seq, created_at, updated_at, deleted_at,
        local_revision, sync_state
      ) VALUES (?, ?, 'Local Pending Name', 'local-icon', '#111111', 'expense', NULL, 1, 0, ?, ?, NULL, 1, 'pending');`,
      [pendingCatId, testUserId, new Date().toISOString(), new Date().toISOString()]
    );

    // Local conflict transaction
    const conflictTxId = 'tx-conflict-1';
    await db.runAsync(
      `INSERT INTO transactions (
        id, user_id, type, amount, category_id, note, date,
        recurring_id, occurrence_date, version, change_seq,
        created_at, updated_at, deleted_at, local_revision, sync_state
      ) VALUES (?, ?, 'expense', 500, ?, 'Local note', '2026-11-07', NULL, NULL, 1, 0, ?, ?, NULL, 1, 'conflict');`,
      [conflictTxId, testUserId, pendingCatId, new Date().toISOString(), new Date().toISOString()]
    );

    // Server returns different data for both rows
    remote.fetchChangesHandler = async (table) => {
      if (table === 'categories') {
        return [
          {
            id: pendingCatId,
            user_id: testUserId,
            name: 'OVERWRITTEN SERVER NAME',
            icon: 'server-icon',
            color: '#999999',
            type: 'expense',
            archived_at: null,
            version: 10,
            change_seq: 100,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-07T00:00:00.000Z',
            deleted_at: null,
          },
        ];
      }
      if (table === 'transactions') {
        return [
          {
            id: conflictTxId,
            user_id: testUserId,
            type: 'expense',
            amount: 99999,
            category_id: pendingCatId,
            note: 'OVERWRITTEN SERVER NOTE',
            date: '2026-11-01',
            recurring_id: null,
            occurrence_date: null,
            version: 10,
            change_seq: 101,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-07T00:00:00.000Z',
            deleted_at: null,
          },
        ];
      }
      return [];
    };

    await pullChanges(db, remote);

    // Verify local pending row was NOT overwritten
    const catRow = await db.getFirstAsync<CategoryRow>(
      'SELECT * FROM categories WHERE id = ?;',
      [pendingCatId]
    );
    expect(catRow?.name).toBe('Local Pending Name');
    expect(catRow?.sync_state).toBe('pending');

    // Verify local conflict row was NOT overwritten
    const txRow = await db.getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?;',
      [conflictTxId]
    );
    expect(txRow?.amount).toBe(500);
    expect(txRow?.sync_state).toBe('conflict');
  });

  // 10. pull handles a soft-deleted server row
  test('pull handles a soft-deleted server row', async () => {
    const catId = 'cat-synced-active';
    await db.runAsync(
      `INSERT INTO categories (
        id, user_id, name, icon, color, type, archived_at,
        version, change_seq, created_at, updated_at, deleted_at,
        local_revision, sync_state
      ) VALUES (?, ?, 'Active Category', 'star', '#FFD700', 'expense', NULL, 1, 5, ?, ?, NULL, 0, 'synced');`,
      [catId, testUserId, new Date().toISOString(), new Date().toISOString()]
    );

    const deletedTimestamp = '2026-11-07T14:00:00.000Z';
    remote.fetchChangesHandler = async (table) => {
      if (table === 'categories') {
        return [
          {
            id: catId,
            user_id: testUserId,
            name: 'Active Category',
            icon: 'star',
            color: '#FFD700',
            type: 'expense',
            archived_at: null,
            version: 2,
            change_seq: 50,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: deletedTimestamp,
            deleted_at: deletedTimestamp,
          },
        ];
      }
      return [];
    };

    const pullSummary = await pullChanges(db, remote);
    expect(pullSummary.pulled).toBe(1);

    const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?;', [
      catId,
    ]);
    expect(row?.deleted_at).toBe(deletedTimestamp);
    expect(row?.sync_state).toBe('synced');
  });

  // 11. categories are applied before transactions
  test('categories are applied before transactions in pull', async () => {
    await pullChanges(db, remote);

    expect(remote.fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect(remote.fetchCalls[0].table).toBe('categories');
    expect(remote.fetchCalls[1].table).toBe('transactions');
  });

  // 12. two simultaneous runSync calls run once
  test('two simultaneous runSync calls run once (single-flight)', async () => {
    // Delay fake remote responses slightly to ensure overlap
    remote.applyMutationHandler = async (entry) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        status: 'applied',
        entity: {
          id: entry.entity_id,
          user_id: testUserId,
          version: 1,
          change_seq: 100,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          ...(entry.payload ? JSON.parse(entry.payload) : {}),
        },
      };
    };

    await createCategory(
      db,
      { name: 'Subscription', icon: 'repeat', color: '#123456', type: 'expense' },
      { userId: testUserId }
    );

    const promise1 = runSync(db, testUserId, remote);
    const promise2 = runSync(db, testUserId, remote);

    // Identical promise reference returned
    expect(promise1).toBe(promise2);

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toEqual(res2);
    expect(res1.pushed).toBe(1);

    // Verified: Only one push operation executed across both calls
    expect(remote.mutationsApplied.length).toBe(1);
  });

  // 13. a database with a different owner is never synced
  test('a database with a different owner is never synced', async () => {
    // Database owner is 'user_123'
    // Attempting to sync as 'user_impostor'
    await createCategory(
      db,
      { name: 'Secret', icon: 'lock', color: '#000000', type: 'expense' },
      { userId: testUserId }
    );

    const summary = await runSync(db, 'user_impostor', remote);
    expect(summary.stoppedBecause).toBe('not_authorized');
    expect(summary.pushed).toBe(0);
    expect(summary.pulled).toBe(0);

    // Remote was never called
    expect(remote.mutationsApplied.length).toBe(0);
    expect(remote.fetchCalls.length).toBe(0);

    // Outbox entry remained pending untouched
    const outbox = await db.getAllAsync<OutboxRow>('SELECT * FROM outbox;');
    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('pending');
  });

  // 14. server edit to synced transaction is applied and cursor advances
  test('server edit to synced transaction is applied and cursor advances', async () => {
    const catRes = await createCategory(
      db,
      { name: 'Dining', icon: 'utensils', color: '#FF5500', type: 'expense' },
      { userId: testUserId }
    );
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) throw new Error('Create category failed');
    const categoryId = catRes.value.id;

    // Push the category so it is synced
    await pushOutbox(db, remote);

    const txId = 'tx-sync-1';
    const nowIso = '2026-11-07T12:00:00.000Z';
    await db.runAsync(
      `INSERT INTO transactions (
        id, user_id, type, amount, category_id, note, date,
        recurring_id, occurrence_date, version, change_seq,
        created_at, updated_at, deleted_at, local_revision, sync_state
      ) VALUES (?, ?, 'expense', 2500, ?, 'Original note', '2026-11-07', NULL, NULL, 1, 100, ?, ?, NULL, 0, 'synced');`,
      [txId, testUserId, categoryId, nowIso, nowIso]
    );

    await db.runAsync(
      "INSERT INTO sync_state_meta (table_name, last_change_seq, updated_at) VALUES ('transactions', 100, ?);",
      [nowIso]
    );

    remote.fetchChangesHandler = async (table) => {
      if (table === 'transactions') {
        return [
          {
            id: txId,
            user_id: testUserId,
            type: 'expense',
            amount: 2500,
            category_id: categoryId,
            note: 'Updated server note',
            date: '2026-11-07',
            recurring_id: null,
            occurrence_date: null,
            version: 2,
            change_seq: 150,
            created_at: nowIso,
            updated_at: '2026-11-07T13:00:00.000Z',
            deleted_at: null,
          },
        ];
      }
      return [];
    };

    const summary = await runSync(db, testUserId, remote);
    expect(summary.stoppedBecause).toBeNull();
    expect(summary.pulled).toBe(1);

    const updatedTx = await db.getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?;',
      [txId]
    );
    expect(updatedTx?.note).toBe('Updated server note');
    expect(updatedTx?.version).toBe(2);
    expect(updatedTx?.change_seq).toBe(150);
    expect(updatedTx?.sync_state).toBe('synced');

    const meta = await db.getFirstAsync<{ last_change_seq: number }>(
      "SELECT last_change_seq FROM sync_state_meta WHERE table_name = 'transactions';"
    );
    expect(meta?.last_change_seq).toBe(150);
  });

  // 15. server edit to a row whose cursor value is lower than stored cursor but inside 500 overlap window is still applied
  test('server edit to a row whose cursor value is lower than stored cursor but inside 500 overlap window is still applied', async () => {
    const catRes = await createCategory(
      db,
      { name: 'Utilities', icon: 'bolt', color: '#FFAA00', type: 'expense' },
      { userId: testUserId }
    );
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) throw new Error('Create category failed');
    const categoryId = catRes.value.id;

    await pushOutbox(db, remote);

    const txId = 'tx-overlap-1';
    const nowIso = '2026-11-07T12:00:00.000Z';
    // Local row has version 1, change_seq 100, note 'Original note'
    await db.runAsync(
      `INSERT INTO transactions (
        id, user_id, type, amount, category_id, note, date,
        recurring_id, occurrence_date, version, change_seq,
        created_at, updated_at, deleted_at, local_revision, sync_state
      ) VALUES (?, ?, 'expense', 1500, ?, 'Original note', '2026-11-07', NULL, NULL, 1, 100, ?, ?, NULL, 0, 'synced');`,
      [txId, testUserId, categoryId, nowIso, nowIso]
    );

    // Stored cursor is 600.
    // Overlap window is 500, so pull requests changes with afterChangeSeq = 600 - 500 = 100.
    await db.runAsync(
      "INSERT INTO sync_state_meta (table_name, last_change_seq, updated_at) VALUES ('transactions', 600, ?);",
      [nowIso]
    );

    // Row on server has change_seq 450 (< 600, but > 100). Note updated, version 2.
    remote.fetchChangesHandler = async (table, afterChangeSeq) => {
      if (table === 'transactions') {
        expect(afterChangeSeq).toBe(100);
        return [
          {
            id: txId,
            user_id: testUserId,
            type: 'expense',
            amount: 1500,
            category_id: categoryId,
            note: 'Updated note within overlap',
            date: '2026-11-07',
            recurring_id: null,
            occurrence_date: null,
            version: 2,
            change_seq: 450,
            created_at: nowIso,
            updated_at: '2026-11-07T13:00:00.000Z',
            deleted_at: null,
          },
        ];
      }
      return [];
    };

    const summary = await runSync(db, testUserId, remote);
    expect(summary.stoppedBecause).toBeNull();
    expect(summary.pulled).toBe(1);

    const updatedTx = await db.getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?;',
      [txId]
    );
    expect(updatedTx?.note).toBe('Updated note within overlap');
    expect(updatedTx?.version).toBe(2);
    expect(updatedTx?.change_seq).toBe(450);
    expect(updatedTx?.sync_state).toBe('synced');

    // Cursor should remain at 600 because 450 < 600
    const meta = await db.getFirstAsync<{ last_change_seq: number }>(
      "SELECT last_change_seq FROM sync_state_meta WHERE table_name = 'transactions';"
    );
    expect(meta?.last_change_seq).toBe(600);
  });
});
