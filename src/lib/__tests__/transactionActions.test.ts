import { SqlJsAdapter } from '@/db/testAdapter';
import { createCategory } from '@/db/repositories/categories';
import { createTransaction, getTransaction } from '@/db/repositories/transactions';
import { deleteWithUndo } from '../transactionActions';
import { ToastOptions } from '@/components/Toast';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => crypto.randomUUID()),
}));

describe('transactionActions - deleteWithUndo', () => {
  let db: SqlJsAdapter;
  const userId = 'user-test-actions';
  let categoryId: string;

  beforeEach(async () => {
    db = await SqlJsAdapter.createWithMigrations();
    // Seed profile
    await db.runAsync(
      `INSERT INTO profiles (id, currency, currency_decimals, version, change_seq, created_at, updated_at)
       VALUES (?, 'USD', 2, 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');`,
      [userId]
    );

    const catRes = await createCategory(db, {
      userId,
      name: 'Groceries',
      icon: 'cart',
      color: '#FFE600',
      type: 'expense',
    });
    expect(catRes.ok).toBe(true);
    categoryId = catRes.ok ? catRes.value.id : '';
  });

  it('soft-deletes transaction and shows toast with Undo action for 5 seconds', async () => {
    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 450,
      category_id: categoryId,
      date: '2026-11-08',
      note: 'Milk and bread',
    });
    expect(txRes.ok).toBe(true);
    const txId = txRes.ok ? txRes.value.id : '';

    // Mark transaction as synced to simulate existing transaction
    await db.runAsync("UPDATE transactions SET sync_state = 'synced', version = 2 WHERE id = ?;", [txId]);
    await db.runAsync('DELETE FROM outbox WHERE entity_id = ?;', [txId]);

    const toastCalls: ToastOptions[] = [];
    const mockToast = {
      showToast: jest.fn((opts: ToastOptions | string) => {
        if (typeof opts !== 'string') {
          toastCalls.push(opts);
        }
      }),
    };

    const success = await deleteWithUndo(db, txId, mockToast);
    expect(success).toBe(true);

    // Verify transaction is hidden locally (deleted_at is set)
    const afterDelete = await getTransaction(db, txId);
    expect(afterDelete).toBeNull();

    // Verify Toast parameters
    expect(mockToast.showToast).toHaveBeenCalledTimes(1);
    const toast = toastCalls[0];
    expect(toast.message).toBe('Deleted');
    expect(toast.duration).toBe(5000);
    expect(toast.action).toBeDefined();
    expect(toast.action?.label).toBe('Undo');

    // Trigger Undo
    await toast.action?.onPress();

    // Verify transaction is restored
    const afterRestore = await getTransaction(db, txId);
    expect(afterRestore).not.toBeNull();
    expect(afterRestore?.id).toBe(txId);
    expect(afterRestore?.deleted_at).toBeNull();
  });

  it('shows error toast when undo is attempted after outbox delete is in-flight (Too late to undo)', async () => {
    const txRes = await createTransaction(db, {
      type: 'expense',
      amount: 1200,
      category_id: categoryId,
      date: '2026-11-08',
    });
    const txId = txRes.ok ? txRes.value.id : '';

    // Mark as synced first so soft delete creates a pending delete mutation
    await db.runAsync("UPDATE transactions SET sync_state = 'synced', version = 2 WHERE id = ?;", [txId]);
    await db.runAsync('DELETE FROM outbox WHERE entity_id = ?;', [txId]);

    const toastCalls: ToastOptions[] = [];
    const mockToast = {
      showToast: jest.fn((opts: ToastOptions | string) => {
        if (typeof opts !== 'string') {
          toastCalls.push(opts);
        }
      }),
    };

    await deleteWithUndo(db, txId, mockToast);

    // Simulate sync in progress (status changed to 'in_flight')
    await db.runAsync(
      "UPDATE outbox SET status = 'in_flight' WHERE entity_id = ? AND op = 'delete';",
      [txId]
    );

    // User taps Undo
    const undoAction = toastCalls[0].action;
    await undoAction?.onPress();

    // Verify second toast announces "Too late to undo"
    expect(mockToast.showToast).toHaveBeenCalledTimes(2);
    expect(toastCalls[1].message).toBe('Too late to undo');
    expect(toastCalls[1].variant).toBe('error');
  });

  it('returns false and shows error toast if deletion fails', async () => {
    const mockToast = {
      showToast: jest.fn(),
    };

    const success = await deleteWithUndo(db, 'non-existent-id', mockToast);
    expect(success).toBe(false);
    expect(mockToast.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
      })
    );
  });
});
