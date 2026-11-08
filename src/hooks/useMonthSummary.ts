import { useCallback } from 'react';
import { DbLike } from '@/db/types';
import { useLiveQuery } from '@/db/live';
import { listTransactionsForMonth } from '@/db/repositories/transactions';
import { monthlySummary, MonthlySummary } from '@/lib/calculations';

/**
 * Convenience hook that observes the 'transactions' table and computes
 * the MonthlySummary for the specified month.
 */
export function useMonthSummary(month: string) {
  const query = useCallback(
    async (db: DbLike): Promise<MonthlySummary> => {
      const transactions = await listTransactionsForMonth(db, month);
      return monthlySummary(transactions, month);
    },
    [month]
  );

  const { data, loading, error, refresh } = useLiveQuery<MonthlySummary>(
    ['transactions'],
    query,
    [month]
  );

  return {
    summary: data,
    loading,
    error,
    refresh,
  };
}
