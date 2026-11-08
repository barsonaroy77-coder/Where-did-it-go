import { useCallback } from 'react';
import { DbLike } from '@/db/types';
import { useLiveQuery } from '@/db/live';
import { getSyncCounts, SyncCounts } from '@/sync/engine';

export interface ExtendedSyncCounts extends SyncCounts {
  unresolvedConflicts: number;
}

const DEFAULT_COUNTS: ExtendedSyncCounts = {
  pending: 0,
  blocked: 0,
  failed: 0,
  unresolvedConflicts: 0,
};

/**
 * Convenience hook that observes the 'outbox' and 'conflicts' tables
 * and provides live counts of pending, blocked, failed mutations, and unresolved conflicts.
 */
export function useSyncCounts() {
  const query = useCallback(async (db: DbLike): Promise<ExtendedSyncCounts> => {
    const baseCounts = await getSyncCounts(db);
    const conflictsRow = await db.getFirstAsync<{ count: number }>(
      'SELECT count(*) as count FROM conflicts WHERE resolved_at IS NULL;'
    );
    const unresolvedConflicts = conflictsRow?.count ?? 0;

    return {
      ...baseCounts,
      unresolvedConflicts,
    };
  }, []);

  const { data, loading, error, refresh } = useLiveQuery<ExtendedSyncCounts>(
    ['outbox', 'conflicts'],
    query,
    []
  );

  return {
    counts: data ?? DEFAULT_COUNTS,
    loading,
    error,
    refresh,
  };
}
