import { useCallback } from 'react';
import { DbLike, CategoryRow, TransactionType } from '@/db/types';
import { useLiveQuery } from '@/db/live';
import { listCategories } from '@/db/repositories/categories';

/**
 * Convenience hook that observes the 'categories' table and returns non-deleted,
 * active categories, optionally filtered by income/expense type.
 */
export function useCategories(type?: TransactionType) {
  const query = useCallback(
    async (db: DbLike): Promise<CategoryRow[]> => {
      const all = await listCategories(db);
      if (!type) {
        return all;
      }
      return all.filter((cat) => cat.type === type);
    },
    [type]
  );

  const { data, loading, error, refresh } = useLiveQuery<CategoryRow[]>(
    ['categories'],
    query,
    [type]
  );

  return {
    categories: data ?? [],
    loading,
    error,
    refresh,
  };
}
