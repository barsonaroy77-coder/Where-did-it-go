import { DbLike } from '../types';

/**
 * Counts all non-deleted financial records across transactions, budgets, recurring rules, and goals.
 * Per PRD Section 5.2, an account's currency choice is locked and may only be changed
 * when this count is zero.
 */
export async function countFinancialRecords(db: DbLike): Promise<number> {
  const result = await db.getFirstAsync<{ total: number }>(`
    SELECT (
      (SELECT count(*) FROM transactions WHERE deleted_at IS NULL) +
      (SELECT count(*) FROM budgets WHERE deleted_at IS NULL) +
      (SELECT count(*) FROM recurring WHERE deleted_at IS NULL) +
      (SELECT count(*) FROM goals WHERE deleted_at IS NULL)
    ) as total;
  `);
  return result?.total ?? 0;
}
