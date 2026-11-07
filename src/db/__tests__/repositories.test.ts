jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => require('crypto').randomUUID()),
}));

import { SqlJsAdapter } from '../testAdapter';
import {
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  restoreCategory,
  getCategory,
  listCategories,
} from '../repositories/categories';
import {
  createTransaction,
  updateTransaction,
  softDeleteTransaction,
  restoreTransaction,
  getTransaction,
  listTransactionsForMonth,
  listTransactionsFiltered,
} from '../repositories/transactions';
import {
  createBudget,
  updateBudget,
  softDeleteBudget,
  restoreBudget,
  getBudget,
  getBudgetForCategory,
  listBudgets,
} from '../repositories/budgets';
import {
  createGoal,
  updateGoal,
  softDeleteGoal,
  restoreGoal,
  getGoal,
  getGoalForMonth,
  listGoalsForMonth,
  listGoals,
} from '../repositories/goals';
import {
  createRecurring,
  updateRecurring,
  softDeleteRecurring,
  restoreRecurring,
  getRecurring,
  listRecurring,
} from '../repositories/recurring';
import { getProfile, upsertProfileFromServer } from '../repositories/profile';
import { getPendingCount, getOutboxEntries } from '../repositories/outbox';
import { countFinancialRecords } from '../repositories/financialRecords';
import { assertDatabaseOwner, canSync } from '../database';
import { OutboxRow, TransactionRow } from '../types';

describe('Local Repositories with Atomic Entity + Outbox Writes', () => {
  let db: SqlJsAdapter;

  beforeEach(async () => {
    db = await SqlJsAdapter.createWithMigrations();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Create transaction: row and outbox entry both exist
  // ---------------------------------------------------------------------------
  it('creates transaction: row and outbox entry both exist, with matching ids, status pending, base_version NULL', async () => {
    const catRes = await createCategory(db, {
      name: 'Food & Dining',
      icon: 'utensils',
      color: '#FFE600',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 1250,
      category_id: catRes.value.id,
      date: '2026-03-15',
      note: 'Lunch with team',
    });

    expect(txRes.ok).toBe(true);
    if (!txRes.ok) return;
    const tx = txRes.value;

    // Check row in SQLite
    const row = await db.getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?;',
      [tx.id]
    );
    expect(row).not.toBeNull();
    expect(row?.id).toBe(tx.id);
    expect(row?.amount).toBe(1250);
    expect(row?.type).toBe('expense');
    expect(row?.category_id).toBe(catRes.value.id);
    expect(row?.note).toBe('Lunch with team');
    expect(row?.date).toBe('2026-03-15');
    expect(row?.sync_state).toBe('pending');
    expect(row?.local_revision).toBe(1);
    expect(row?.deleted_at).toBeNull();

    // Check outbox entry in SQLite
    const outboxRows = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [tx.id]
    );
    expect(outboxRows).toHaveLength(1);
    const outbox = outboxRows[0];

    expect(outbox.entity_id).toBe(tx.id);
    expect(outbox.table_name).toBe('transactions');
    expect(outbox.op).toBe('create');
    expect(outbox.base_version).toBeNull();
    expect(outbox.status).toBe('pending');
    expect(outbox.local_revision).toBe(1);
    expect(typeof outbox.mutation_id).toBe('string');
    expect(outbox.mutation_id.length).toBeGreaterThan(10);

    // Payload has ONLY writable fields accepted by apply_mutation
    const payload = JSON.parse(outbox.payload || '{}');
    expect(payload).toEqual({
      type: 'expense',
      amount: 1250,
      category_id: catRes.value.id,
      note: 'Lunch with team',
      date: '2026-03-15',
      recurring_id: null,
      occurrence_date: null,
    });
    expect(payload.id).toBeUndefined();
    expect(payload.user_id).toBeUndefined();
    expect(payload.version).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Atomic rollback on failure
  // ---------------------------------------------------------------------------
  it('simulates a failure after the row write and proves NOTHING was saved, row and outbox together', async () => {
    const catRes = await createCategory(db, {
      name: 'Utilities',
      icon: 'bolt',
      color: '#00FFFF',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    // Call createTransaction with simulated failure after row write
    const failRes = await createTransaction(
      db,
      {
        type: 'expense',
        amount: 8800,
        category_id: catRes.value.id,
        date: '2026-03-16',
        note: 'Electric bill',
      },
      { _simulateFailureAfterRowWrite: true }
    );

    expect(failRes.ok).toBe(false);
    if (failRes.ok) throw new Error('Expected failure');
    expect(failRes.error).toContain('Simulated failure after row write');

    // Verify row was NOT saved in SQLite
    const txRow = await db.getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE note = ?;',
      ['Electric bill']
    );
    expect(txRow).toBeNull();

    // Verify outbox entry was NOT saved in SQLite
    const outboxEntries = await db.getAllAsync<OutboxRow>(
      "SELECT * FROM outbox WHERE table_name = 'transactions';"
    );
    expect(outboxEntries).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Outbox Coalescing: two quick edits produce ONE outbox entry
  // ---------------------------------------------------------------------------
  it('two quick edits to one pending entity produce ONE outbox entry with the merged payload and original mutation_id', async () => {
    const catRes = await createCategory(db, {
      name: 'Groceries',
      icon: 'cart',
      color: '#00FF00',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;
    const catId = catRes.value.id;

    // Get initial create mutation_id
    const initialOutbox = await db.getFirstAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [catId]
    );
    expect(initialOutbox).not.toBeNull();
    const initialMutationId = initialOutbox?.mutation_id;

    // Quick edit 1: update name
    const edit1 = await updateCategory(db, catId, { name: 'Supermarket' });
    expect(edit1.ok).toBe(true);

    // Quick edit 2: update color
    const edit2 = await updateCategory(db, catId, { color: '#0000FF' });
    expect(edit2.ok).toBe(true);

    // Outbox must contain EXACTLY ONE entry for this entity
    const outboxRows = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [catId]
    );
    expect(outboxRows).toHaveLength(1);
    const entry = outboxRows[0];

    // Preserves original mutation_id, op, and base_version
    expect(entry.mutation_id).toBe(initialMutationId);
    expect(entry.op).toBe('create');
    expect(entry.base_version).toBeNull();
    expect(entry.local_revision).toBe(3);

    // Payload contains merged values from both edits
    const payload = JSON.parse(entry.payload || '{}');
    expect(payload.name).toBe('Supermarket');
    expect(payload.color).toBe('#0000FF');
    expect(payload.icon).toBe('cart');
    expect(payload.type).toBe('expense');
  });

  // ---------------------------------------------------------------------------
  // Test 4: Pending create + delete leaves no row and no outbox entry
  // ---------------------------------------------------------------------------
  it('create then delete before sync leaves no row and no entry', async () => {
    const goalRes = await createGoal(db, {
      name: 'Vacation Trip',
      target_amount: 150000,
      month: '2026-08-01',
    });
    expect(goalRes.ok).toBe(true);
    if (!goalRes.ok) return;
    const goalId = goalRes.value.id;

    // Confirm row and outbox exist
    const goalBefore = await getGoal(db, goalId);
    expect(goalBefore).not.toBeNull();
    const outboxBefore = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [goalId]
    );
    expect(outboxBefore).toHaveLength(1);

    // Soft delete before sync
    const delRes = await softDeleteGoal(db, goalId);
    expect(delRes.ok).toBe(true);

    // Physical row must be completely removed from SQLite
    const rawGoal = await db.getFirstAsync(
      'SELECT * FROM goals WHERE id = ?;',
      [goalId]
    );
    expect(rawGoal).toBeNull();

    // Outbox entry must be completely removed
    const outboxAfter = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [goalId]
    );
    expect(outboxAfter).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: In-flight entry left untouched, second entry added with base_version NULL
  // ---------------------------------------------------------------------------
  it('update an entity whose entry is in_flight adds a second entry with base_version NULL and leaves the first untouched', async () => {
    const catRes = await createCategory(db, {
      name: 'Coffee',
      icon: 'cup',
      color: '#6F4E37',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 450,
      category_id: catRes.value.id,
      date: '2026-03-20',
      note: 'Espresso',
    });
    expect(txRes.ok).toBe(true);
    if (!txRes.ok) return;
    const txId = txRes.value.id;

    // Simulate sync engine marking the first entry as 'in_flight'
    await db.runAsync(
      "UPDATE outbox SET status = 'in_flight' WHERE entity_id = ?;",
      [txId]
    );

    const firstEntry = await db.getFirstAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [txId]
    );
    expect(firstEntry?.status).toBe('in_flight');

    // Update the transaction while first mutation is in flight
    const updateRes = await updateTransaction(db, txId, { note: 'Double Espresso' });
    expect(updateRes.ok).toBe(true);

    // Outbox must now have TWO entries
    const allEntries = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ? ORDER BY sequence ASC;',
      [txId]
    );
    expect(allEntries).toHaveLength(2);

    // First entry is unchanged
    expect(allEntries[0].sequence).toBe(firstEntry?.sequence);
    expect(allEntries[0].status).toBe('in_flight');
    expect(allEntries[0].mutation_id).toBe(firstEntry?.mutation_id);
    expect(JSON.parse(allEntries[0].payload || '{}').note).toBe('Espresso');

    // Second entry is a new pending entry with base_version NULL
    expect(allEntries[1].status).toBe('pending');
    expect(allEntries[1].op).toBe('update');
    expect(allEntries[1].base_version).toBeNull();
    expect(allEntries[1].mutation_id).not.toBe(firstEntry?.mutation_id);
    expect(JSON.parse(allEntries[1].payload || '{}').note).toBe('Double Espresso');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Soft delete hides row; restore inside window; restore rejected after in_flight
  // ---------------------------------------------------------------------------
  it('soft delete hides row from lists; restore inside window removes delete entry; restore after in_flight is rejected', async () => {
    // 1. Setup a synced category and transaction
    const catRes = await createCategory(db, {
      name: 'Books',
      icon: 'book',
      color: '#336699',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 2500,
      category_id: catRes.value.id,
      date: '2026-03-21',
      note: 'TypeScript Handbook',
    });
    expect(txRes.ok).toBe(true);
    if (!txRes.ok) return;
    const txId = txRes.value.id;

    // Simulate that this transaction was previously synced
    await db.runAsync("UPDATE transactions SET sync_state = 'synced', version = 2 WHERE id = ?;", [txId]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [txId]);

    // Verify row appears in list
    const initialList = await listTransactionsForMonth(db, '2026-03-01');
    expect(initialList.some((t) => t.id === txId)).toBe(true);

    // Soft delete
    const delRes = await softDeleteTransaction(db, txId);
    expect(delRes.ok).toBe(true);

    // Soft delete hides row from read functions
    const afterDelGet = await getTransaction(db, txId);
    expect(afterDelGet).toBeNull();

    const afterDelList = await listTransactionsForMonth(db, '2026-03-01');
    expect(afterDelList.some((t) => t.id === txId)).toBe(false);

    const afterDelFiltered = await listTransactionsFiltered(db, {});
    expect(afterDelFiltered.some((t) => t.id === txId)).toBe(false);

    // Outbox has a pending delete entry with base_version = 2
    const delOutbox = await db.getFirstAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [txId]
    );
    expect(delOutbox?.op).toBe('delete');
    expect(delOutbox?.status).toBe('pending');
    expect(delOutbox?.base_version).toBe(2);
    expect(delOutbox?.next_attempt_at).not.toBeNull();

    // Restore inside window
    const restoreRes = await restoreTransaction(db, txId);
    expect(restoreRes.ok).toBe(true);
    if (!restoreRes.ok) throw new Error(restoreRes.error);
    expect(restoreRes.value.deleted_at).toBeNull();

    // Delete entry was removed from outbox
    const outboxAfterRestore = await db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE entity_id = ?;',
      [txId]
    );
    expect(outboxAfterRestore).toHaveLength(0);

    // Row is visible again in list
    const restoredList = await listTransactionsForMonth(db, '2026-03-01');
    expect(restoredList.some((t) => t.id === txId)).toBe(true);

    // Now soft delete again and simulate in_flight
    await softDeleteTransaction(db, txId);
    await db.runAsync(
      "UPDATE outbox SET status = 'in_flight' WHERE entity_id = ? AND op = 'delete';",
      [txId]
    );

    // Restore after in_flight must be rejected
    const rejectedRestore = await restoreTransaction(db, txId);
    expect(rejectedRestore.ok).toBe(false);
    if (rejectedRestore.ok) throw new Error('Expected failure');
    expect(rejectedRestore.error).toBe('Too late to undo');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Category validations (type mismatch, archived, deleted)
  // ---------------------------------------------------------------------------
  it('category type mismatch, archived category and deleted category are all rejected for new transactions', async () => {
    // 7a. Income category
    const incomeCat = await createCategory(db, {
      name: 'Salary',
      icon: 'wallet',
      color: '#00AA00',
      type: 'income',
    });
    expect(incomeCat.ok).toBe(true);
    if (!incomeCat.ok) return;

    // Attempt expense transaction with income category -> type mismatch
    const mismatchRes = await createTransaction(db, {
      type: 'expense',
      amount: 1000,
      category_id: incomeCat.value.id,
      date: '2026-03-22',
    });
    expect(mismatchRes.ok).toBe(false);
    if (mismatchRes.ok) throw new Error('Expected failure');
    expect(mismatchRes.error).toContain('Category type mismatch');

    // 7b. Archived category
    const archivedCat = await createCategory(db, {
      name: 'Old Gym Membership',
      icon: 'dumbbell',
      color: '#777777',
      type: 'expense',
      archived_at: '2026-01-01T00:00:00.000Z',
    });
    expect(archivedCat.ok).toBe(true);
    if (!archivedCat.ok) return;

    const archivedRes = await createTransaction(db, {
      type: 'expense',
      amount: 3000,
      category_id: archivedCat.value.id,
      date: '2026-03-22',
    });
    expect(archivedRes.ok).toBe(false);
    if (archivedRes.ok) throw new Error('Expected failure');
    expect(archivedRes.error).toContain('Category is archived');

    // 7c. Deleted category
    const toDeleteCat = await createCategory(db, {
      name: 'Temporary Cat',
      icon: 'tag',
      color: '#FF0000',
      type: 'expense',
    });
    expect(toDeleteCat.ok).toBe(true);
    if (!toDeleteCat.ok) return;

    // Simulate synced category and soft delete it
    await db.runAsync("UPDATE categories SET sync_state = 'synced' WHERE id = ?;", [toDeleteCat.value.id]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [toDeleteCat.value.id]);
    await deleteCategory(db, toDeleteCat.value.id);

    const deletedRes = await createTransaction(db, {
      type: 'expense',
      amount: 500,
      category_id: toDeleteCat.value.id,
      date: '2026-03-22',
    });
    expect(deletedRes.ok).toBe(false);
    if (deletedRes.ok) throw new Error('Expected failure');
    expect(deletedRes.error).toContain('Category does not exist or has been deleted');
  });

  // ---------------------------------------------------------------------------
  // Test 8: Single active budget per category constraint
  // ---------------------------------------------------------------------------
  it('a second budget for the same category is rejected', async () => {
    const catRes = await createCategory(db, {
      name: 'Dining',
      icon: 'utensils',
      color: '#FFAA00',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    // First budget
    const b1 = await createBudget(db, {
      category_id: catRes.value.id,
      monthly_limit: 30000,
    });
    expect(b1.ok).toBe(true);

    // Second active budget for same category must fail
    const b2 = await createBudget(db, {
      category_id: catRes.value.id,
      monthly_limit: 40000,
    });
    expect(b2.ok).toBe(false);
    if (b2.ok) throw new Error('Expected failure');
    expect(b2.error).toContain('An active budget already exists for this category');

    // Income category budget must also fail
    const incomeCat = await createCategory(db, {
      name: 'Freelance',
      icon: 'laptop',
      color: '#00AAFF',
      type: 'income',
    });
    expect(incomeCat.ok).toBe(true);
    if (!incomeCat.ok) return;

    const bIncome = await createBudget(db, {
      category_id: incomeCat.value.id,
      monthly_limit: 50000,
    });
    expect(bIncome.ok).toBe(false);
    if (bIncome.ok) throw new Error('Expected failure');
    expect(bIncome.error).toContain('Budgets can only be created for expense categories');
  });

  // ---------------------------------------------------------------------------
  // Test 9: Archived categories behavior & PRD 6.2 category archiving
  // ---------------------------------------------------------------------------
  it('archived categories still appear when includeArchived is true', async () => {
    const activeCat = await createCategory(db, {
      name: 'Active Rent',
      icon: 'home',
      color: '#111111',
      type: 'expense',
    });
    expect(activeCat.ok).toBe(true);

    const archivedCat = await createCategory(db, {
      name: 'Archived Subscriptions',
      icon: 'tv',
      color: '#222222',
      type: 'expense',
      archived_at: '2026-01-15T00:00:00.000Z',
    });
    expect(archivedCat.ok).toBe(true);

    // Default list excludes archived
    const listDefault = await listCategories(db);
    expect(listDefault.some((c) => c.name === 'Active Rent')).toBe(true);
    expect(listDefault.some((c) => c.name === 'Archived Subscriptions')).toBe(false);

    // List with includeArchived includes both
    const listAll = await listCategories(db, { includeArchived: true });
    expect(listAll.some((c) => c.name === 'Active Rent')).toBe(true);
    expect(listAll.some((c) => c.name === 'Archived Subscriptions')).toBe(true);

    // PRD 6.2: Deleting a category with non-deleted transactions archives it automatically
    if (!activeCat.ok) return;
    await createTransaction(db, {
      type: 'expense',
      amount: 100000,
      category_id: activeCat.value.id,
      date: '2026-03-01',
    });

    const delRes = await deleteCategory(db, activeCat.value.id);
    expect(delRes.ok).toBe(true);
    if (!delRes.ok) return;
    expect(delRes.value.archived).toBe(true);
    expect(delRes.value.category.archived_at).not.toBeNull();
    expect(delRes.value.category.deleted_at).toBeNull();

    // Still appears with includeArchived: true
    const listAfterAutoArchive = await listCategories(db, { includeArchived: true });
    expect(listAfterAutoArchive.some((c) => c.id === activeCat.value.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 10: Multi-database isolation (strict per-account partition)
  // ---------------------------------------------------------------------------
  it('all queries return rows only from this database (use two separate in-memory databases to prove isolation)', async () => {
    const dbA = await SqlJsAdapter.createWithMigrations();
    const dbB = await SqlJsAdapter.createWithMigrations();

    // Create records exclusively in Database A
    const catA = await createCategory(dbA, {
      name: 'User A Secret Category',
      icon: 'lock',
      color: '#000000',
      type: 'expense',
    });
    expect(catA.ok).toBe(true);
    if (!catA.ok) return;

    await createTransaction(dbA, {
      type: 'expense',
      amount: 9999,
      category_id: catA.value.id,
      date: '2026-03-25',
      note: 'Confidential transaction',
    });

    // Verify Database A has the records
    const listA = await listCategories(dbA);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe('User A Secret Category');
    const txListA = await listTransactionsForMonth(dbA, '2026-03-01');
    expect(txListA).toHaveLength(1);
    expect(await countFinancialRecords(dbA)).toBe(1);

    // Verify Database B is completely empty and isolated
    const listB = await listCategories(dbB);
    expect(listB).toHaveLength(0);
    const txListB = await listTransactionsForMonth(dbB, '2026-03-01');
    expect(txListB).toHaveLength(0);
    expect(await countFinancialRecords(dbB)).toBe(0);
    expect(await getPendingCount(dbB)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Monetary values are strictly stored as integers
  // ---------------------------------------------------------------------------
  it('amounts are stored as integers', async () => {
    const catRes = await createCategory(db, {
      name: 'Shopping',
      icon: 'bag',
      color: '#E91E63',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    if (!catRes.ok) return;

    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 4999, // $49.99 in minor units
      category_id: catRes.value.id,
      date: '2026-03-26',
    });
    expect(txRes.ok).toBe(true);
    if (!txRes.ok) return;

    // TypeScript value check
    expect(typeof txRes.value.amount).toBe('number');
    expect(Number.isInteger(txRes.value.amount)).toBe(true);
    expect(txRes.value.amount).toBe(4999);

    // Raw database integer storage check
    const raw = await db.getFirstAsync<{ amount: number }>(
      'SELECT amount FROM transactions WHERE id = ?;',
      [txRes.value.id]
    );
    expect(typeof raw?.amount).toBe('number');
    expect(Number.isInteger(raw?.amount)).toBe(true);
    expect(raw?.amount).toBe(4999);
  });

  // ---------------------------------------------------------------------------
  // Additional Coverage: Goals, Budgets, Recurring, Profile Cache, and Helpers
  // ---------------------------------------------------------------------------
  it('verifies recurring rules creation, updates, and soft-delete/restore', async () => {
    const cat = await createCategory(db, {
      name: 'Internet',
      icon: 'wifi',
      color: '#2196F3',
      type: 'expense',
    });
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    const rec = await createRecurring(db, {
      type: 'expense',
      amount: 6000,
      category_id: cat.value.id,
      note: 'Fiber subscription',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_date: '2026-04-01',
      schedule_timezone: 'UTC',
      anchor_day: 1,
      is_active: true,
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    expect(rec.value.frequency).toBe('monthly');
    expect(rec.value.amount).toBe(6000);

    const list = await listRecurring(db);
    expect(list).toHaveLength(1);

    // Update
    const updated = await updateRecurring(db, rec.value.id, { amount: 6500 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.value.amount).toBe(6500);

    // Simulate rule is synced so soft-delete can be tested with undo
    await db.runAsync("UPDATE recurring SET sync_state = 'synced', version = 2 WHERE id = ?;", [rec.value.id]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [rec.value.id]);

    // Soft delete
    const del = await softDeleteRecurring(db, rec.value.id);
    expect(del.ok).toBe(true);
    expect(await listRecurring(db)).toHaveLength(0);

    // Restore
    const restored = await restoreRecurring(db, rec.value.id);
    expect(restored.ok).toBe(true);
    expect(await listRecurring(db)).toHaveLength(1);

    const fetchedRec = await getRecurring(db, rec.value.id);
    expect(fetchedRec).not.toBeNull();
    expect(fetchedRec?.id).toBe(rec.value.id);
  });

  it('verifies explicit archiveCategory, restoreCategory, and getCategory', async () => {
    const cat = await createCategory(db, {
      name: 'Old Hobbies',
      icon: 'palette',
      color: '#9C27B0',
      type: 'expense',
    });
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    // Explicit archive
    const archived = await archiveCategory(db, cat.value.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error(archived.error);
    expect(archived.value.archived_at).not.toBeNull();

    // getCategory still returns it because it is not soft-deleted
    const fetched = await getCategory(db, cat.value.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Old Hobbies');

    // Simulate synced category
    await db.runAsync("UPDATE categories SET sync_state = 'synced', version = 2 WHERE id = ?;", [cat.value.id]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [cat.value.id]);

    // Soft delete
    const del = await deleteCategory(db, cat.value.id);
    expect(del.ok).toBe(true);
    expect(await getCategory(db, cat.value.id)).toBeNull();

    // Restore
    const restored = await restoreCategory(db, cat.value.id);
    expect(restored.ok).toBe(true);
    expect(await getCategory(db, cat.value.id)).not.toBeNull();
  });

  it('verifies budget updates, queries, and soft-delete/restore', async () => {
    const cat = await createCategory(db, {
      name: 'Entertainment',
      icon: 'film',
      color: '#FF5722',
      type: 'expense',
    });
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    const b = await createBudget(db, {
      category_id: cat.value.id,
      monthly_limit: 20000,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    // getBudget and getBudgetForCategory
    const byId = await getBudget(db, b.value.id);
    expect(byId).not.toBeNull();
    expect(byId?.monthly_limit).toBe(20000);

    const byCat = await getBudgetForCategory(db, cat.value.id);
    expect(byCat).not.toBeNull();
    expect(byCat?.id).toBe(b.value.id);

    const all = await listBudgets(db);
    expect(all).toHaveLength(1);

    // Update
    const updated = await updateBudget(db, b.value.id, { monthly_limit: 25000 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.value.monthly_limit).toBe(25000);

    // Simulate synced budget
    await db.runAsync("UPDATE budgets SET sync_state = 'synced', version = 2 WHERE id = ?;", [b.value.id]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [b.value.id]);

    // Soft delete
    const del = await softDeleteBudget(db, b.value.id);
    expect(del.ok).toBe(true);
    expect(await getBudget(db, b.value.id)).toBeNull();
    expect(await listBudgets(db)).toHaveLength(0);

    // Restore
    const restored = await restoreBudget(db, b.value.id);
    expect(restored.ok).toBe(true);
    expect(await listBudgets(db)).toHaveLength(1);
  });

  it('verifies goal updates, monthly queries, and soft-delete/restore', async () => {
    const goal = await createGoal(db, {
      name: 'New Car',
      target_amount: 500000,
      month: '2026-12-01',
    });
    expect(goal.ok).toBe(true);
    if (!goal.ok) return;

    // getGoalForMonth, listGoalsForMonth, listGoals
    const byMonth = await getGoalForMonth(db, '2026-12-01');
    expect(byMonth).not.toBeNull();
    expect(byMonth?.id).toBe(goal.value.id);

    const listMonth = await listGoalsForMonth(db, '2026-12-01');
    expect(listMonth).toHaveLength(1);

    const allGoals = await listGoals(db);
    expect(allGoals).toHaveLength(1);

    // Update
    const updated = await updateGoal(db, goal.value.id, { target_amount: 550000 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.value.target_amount).toBe(550000);

    // Simulate synced goal
    await db.runAsync("UPDATE goals SET sync_state = 'synced', version = 2 WHERE id = ?;", [goal.value.id]);
    await db.runAsync("DELETE FROM outbox WHERE entity_id = ?;", [goal.value.id]);

    // Soft delete
    const del = await softDeleteGoal(db, goal.value.id);
    expect(del.ok).toBe(true);
    expect(await getGoal(db, goal.value.id)).toBeNull();
    expect(await listGoals(db)).toHaveLength(0);

    // Restore
    const restored = await restoreGoal(db, goal.value.id);
    expect(restored.ok).toBe(true);
    expect(await listGoals(db)).toHaveLength(1);
  });

  it('verifies profile cache upsert does NOT touch the outbox', async () => {
    const profileRes = await upsertProfileFromServer(db, {
      id: '11111111-2222-3333-4444-555555555555',
      currency: 'USD',
      currency_decimals: 2,
      version: 5,
      change_seq: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    expect(profileRes.ok).toBe(true);
    if (!profileRes.ok) throw new Error(profileRes.error);
    expect(profileRes.value.currency).toBe('USD');
    expect(profileRes.value.sync_state).toBe('synced');

    const cached = await getProfile(db);
    expect(cached?.currency).toBe('USD');

    // Critical requirement: profile mutations NEVER use the outbox
    const outbox = await getOutboxEntries(db);
    expect(outbox).toHaveLength(0);
    expect(await getPendingCount(db)).toBe(0);
  });

  it('verifies countFinancialRecords correctly aggregates active records', async () => {
    expect(await countFinancialRecords(db)).toBe(0);

    const cat = await createCategory(db, {
      name: 'Salary',
      icon: 'briefcase',
      color: '#4CAF50',
      type: 'income',
    });
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    // Categories are NOT financial records (financial records lock the currency choice)
    expect(await countFinancialRecords(db)).toBe(0);

    // Add transaction (+1)
    await createTransaction(db, {
      type: 'income',
      amount: 500000,
      category_id: cat.value.id,
      date: '2026-03-01',
    });
    expect(await countFinancialRecords(db)).toBe(1);

    // Add goal (+1)
    await createGoal(db, {
      name: 'Emergency Fund',
      target_amount: 1000000,
      month: '2026-04-01',
    });
    expect(await countFinancialRecords(db)).toBe(2);
  });
});

describe('Account Switching & Database Isolation (Phase 4 Part 5)', () => {
  it('stores owner_user_id and rejects owner mismatch on subsequent access', async () => {
    const dbA = await SqlJsAdapter.createWithMigrations();
    const userA = 'user-uuid-1111-aaaa';
    const userB = 'user-uuid-2222-bbbb';

    // First time open/init stores owner_user_id
    await assertDatabaseOwner(dbA, userA);

    // Verify stored owner
    const meta = await dbA.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_meta WHERE key = 'owner_user_id';"
    );
    expect(meta?.value).toBe(userA);

    // canSync returns true for matching owner
    expect(await canSync(dbA, userA)).toBe(true);

    // canSync returns false for different user
    expect(await canSync(dbA, userB)).toBe(false);

    // assertDatabaseOwner succeeds when the same user accesses it
    await expect(assertDatabaseOwner(dbA, userA)).resolves.not.toThrow();

    // assertDatabaseOwner throws error when a different user accesses it
    await expect(assertDatabaseOwner(dbA, userB)).rejects.toThrow(
      /Database owner mismatch/i
    );
  });

  it('guarantees user A outbox is not visible from user B database partition', async () => {
    // Two separate in-memory test databases representing separate account partitions
    const dbA = await SqlJsAdapter.createWithMigrations();
    const dbB = await SqlJsAdapter.createWithMigrations();
    const userA = 'user-A-id-001';
    const userB = 'user-B-id-002';

    await assertDatabaseOwner(dbA, userA);
    await assertDatabaseOwner(dbB, userB);

    // User A creates a category and a transaction in dbA
    const catA = await createCategory(
      dbA,
      {
        name: 'User A Food',
        icon: 'utensils',
        color: '#FFAA00',
        type: 'expense',
      },
      { userId: userA }
    );
    expect(catA.ok).toBe(true);
    if (!catA.ok) return;

    const txA = await createTransaction(
      dbA,
      {
        type: 'expense',
        amount: 4500,
        category_id: catA.value.id,
        date: '2026-03-10',
        note: 'User A groceries',
      },
      { userId: userA }
    );
    expect(txA.ok).toBe(true);
    if (!txA.ok) return;

    // Verify user A has 2 outbox entries in dbA
    const outboxA = await getOutboxEntries(dbA);
    expect(outboxA).toHaveLength(2);
    expect(await getPendingCount(dbA)).toBe(2);

    // CRITICAL: User B's database must have ZERO outbox entries
    // User A's outbox is completely invisible from user B's database
    const outboxB = await getOutboxEntries(dbB);
    expect(outboxB).toHaveLength(0);
    expect(await getPendingCount(dbB)).toBe(0);

    // User B now creates their own category and transaction in dbB
    const catB = await createCategory(
      dbB,
      {
        name: 'User B Transport',
        icon: 'car',
        color: '#00AAFF',
        type: 'expense',
      },
      { userId: userB }
    );
    expect(catB.ok).toBe(true);
    if (!catB.ok) return;

    const txB = await createTransaction(
      dbB,
      {
        type: 'expense',
        amount: 2000,
        category_id: catB.value.id,
        date: '2026-03-12',
        note: 'User B fuel',
      },
      { userId: userB }
    );
    expect(txB.ok).toBe(true);
    if (!txB.ok) return;

    // Verify user B's outbox entries in dbB
    const outboxBAfter = await getOutboxEntries(dbB);
    expect(outboxBAfter).toHaveLength(2);
    expect(outboxBAfter.map((o) => o.entity_id)).toEqual([catB.value.id, txB.value.id]);

    // Verify user A's outbox in dbA still contains only user A's entries
    const outboxAAfter = await getOutboxEntries(dbA);
    expect(outboxAAfter).toHaveLength(2);
    expect(outboxAAfter.map((o) => o.entity_id)).toEqual([catA.value.id, txA.value.id]);

    // Cross-user sync permissions
    expect(await canSync(dbA, userA)).toBe(true);
    expect(await canSync(dbA, userB)).toBe(false);
    expect(await canSync(dbB, userB)).toBe(true);
    expect(await canSync(dbB, userA)).toBe(false);
  });
});
