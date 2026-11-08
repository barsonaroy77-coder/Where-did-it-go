import { SqlJsAdapter } from '../testAdapter';
import {
  emitTableChange,
  subscribeTableChange,
  withTransactionAndNotify,
  _resetSubscriptionsForTesting,
} from '../events';

describe('Database Live Refresh Layer - Events & Transaction Wrapper', () => {
  let db: SqlJsAdapter;

  beforeEach(async () => {
    _resetSubscriptionsForTesting();
    db = await SqlJsAdapter.createWithMigrations();
  });

  afterEach(() => {
    _resetSubscriptionsForTesting();
  });

  test('publish after commit: listener is called after transaction commits successfully', async () => {
    const changes: string[][] = [];
    const unsubscribe = subscribeTableChange(['transactions', 'outbox'], (tables) => {
      changes.push(tables);
    });

    await withTransactionAndNotify(db, ['transactions', 'outbox'], async () => {
      await db.runAsync(
        `INSERT INTO categories (
          id, user_id, name, icon, color, type, version, change_seq,
          created_at, updated_at, local_revision, sync_state
        ) VALUES ('cat-1', 'user-1', 'Groceries', 'cart', '#000', 'expense', 1, 0, '2026-11-01', '2026-11-01', 1, 'synced');`
      );
      await db.runAsync(
        `INSERT INTO transactions (
          id, user_id, type, amount, category_id, date, version, change_seq,
          created_at, updated_at, local_revision, sync_state
        ) VALUES ('tx-1', 'user-1', 'expense', 1500, 'cat-1', '2026-11-01', 1, 0, '2026-11-01', '2026-11-01', 1, 'pending');`
      );
    });

    expect(changes.length).toBe(1);
    expect(changes[0]).toEqual(['transactions', 'outbox']);

    // Verify row was actually committed in database
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM transactions WHERE id = ?;', ['tx-1']);
    expect(row).not.toBeNull();
    expect(row?.id).toBe('tx-1');

    unsubscribe();
  });

  test('no event on rollback: if transaction fails/throws, no event is emitted and data is rolled back', async () => {
    const changes: string[][] = [];
    const unsubscribe = subscribeTableChange(['transactions'], (tables) => {
      changes.push(tables);
    });

    // Ensure category exists so foreign key wouldn't fail on insertion
    await db.runAsync(
      `INSERT INTO categories (
        id, user_id, name, icon, color, type, version, change_seq,
        created_at, updated_at, local_revision, sync_state
      ) VALUES ('cat-1', 'user-1', 'Groceries', 'cart', '#000', 'expense', 1, 0, '2026-11-01', '2026-11-01', 1, 'synced');`
    );

    await expect(
      withTransactionAndNotify(db, ['transactions'], async () => {
        await db.runAsync(
          `INSERT INTO transactions (
            id, user_id, type, amount, category_id, date, version, change_seq,
            created_at, updated_at, local_revision, sync_state
          ) VALUES ('tx-fail', 'user-1', 'expense', 1500, 'cat-1', '2026-11-01', 1, 0, '2026-11-01', '2026-11-01', 1, 'pending');`
        );
        throw new Error('Simulated database error causing rollback');
      })
    ).rejects.toThrow('Simulated database error causing rollback');

    // Crucial check: listener must NOT have been called
    expect(changes.length).toBe(0);

    // Verify row was rolled back in SQLite
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM transactions WHERE id = ?;', ['tx-fail']);
    expect(row).toBeNull();

    unsubscribe();
  });

  test('unsubscribe works: removing listener stops receiving subsequent events', () => {
    let callCount = 0;
    const unsubscribe = subscribeTableChange(['transactions'], () => {
      callCount++;
    });

    emitTableChange('transactions');
    expect(callCount).toBe(1);

    // Unsubscribe
    unsubscribe();

    emitTableChange('transactions');
    expect(callCount).toBe(1); // Call count remains 1
  });

  test('table filtering: listeners only receive events for tables they subscribed to', () => {
    const catEvents: string[][] = [];
    const txEvents: string[][] = [];

    const unsubCat = subscribeTableChange(['categories'], (t) => catEvents.push(t));
    const unsubTx = subscribeTableChange(['transactions'], (t) => txEvents.push(t));

    emitTableChange('categories');
    expect(catEvents.length).toBe(1);
    expect(txEvents.length).toBe(0);

    emitTableChange('transactions');
    expect(catEvents.length).toBe(1);
    expect(txEvents.length).toBe(1);

    emitTableChange(['categories', 'transactions']);
    expect(catEvents.length).toBe(2);
    expect(txEvents.length).toBe(2);

    unsubCat();
    unsubTx();
  });
});
