/**
 * Reusable transaction actions for Where Did It Go?
 * Follows PRD v4.0 Section 6.1 and AGENTS.md rules.
 */

import { DbLike } from '@/db/types';
import { softDeleteTransaction, restoreTransaction } from '@/db/repositories/transactions';
import { ToastOptions } from '@/components/Toast';

export interface ToastTarget {
  showToast: (options: ToastOptions | string) => void;
}

/**
 * Soft-deletes a transaction and shows a 5-second "Deleted" toast with an "Undo" action.
 * If Undo is tapped, restores the transaction; if the restore fails or is too late,
 * shows an error toast.
 *
 * @param db Active SQLite database
 * @param id Transaction ID to delete
 * @param toast Toast provider handle
 * @returns boolean true if deletion was successful locally, false otherwise
 */
export async function deleteWithUndo(
  db: DbLike,
  id: string,
  toast: ToastTarget
): Promise<boolean> {
  const result = await softDeleteTransaction(db, id);

  if (!result.ok) {
    toast.showToast({
      message: result.error || 'Failed to delete transaction',
      variant: 'error',
    });
    return false;
  }

  toast.showToast({
    message: 'Deleted',
    duration: 5000,
    action: {
      label: 'Undo',
      accessibilityLabel: 'Undo delete',
      onPress: async () => {
        try {
          const restoreRes = await restoreTransaction(db, id);
          if (!restoreRes.ok) {
            const isTooLate = restoreRes.error?.toLowerCase().includes('too late');
            toast.showToast({
              message: isTooLate ? 'Too late to undo' : (restoreRes.error || 'Failed to restore transaction'),
              variant: 'error',
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isTooLate = msg.toLowerCase().includes('too late');
          toast.showToast({
            message: isTooLate ? 'Too late to undo' : 'Failed to restore transaction',
            variant: 'error',
          });
        }
      },
    },
  });

  return true;
}
