import { useEffect, useState, useRef, useCallback } from 'react';
import { DbLike } from './types';
import { useDatabase } from './DatabaseProvider';
import { subscribeTableChange } from './events';

export interface LiveQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * useLiveQuery:
 * Runs a query against the active SQLite database, re-runs when any of the specified
 * tables change, ignores stale results from older runs, and cleans up on unmount.
 *
 * @param tables Array of table names to observe for changes.
 * @param query Function that executes queries against SQLite and returns a promise.
 * @param deps Additional dependency array triggering a re-query on change.
 */
export function useLiveQuery<T>(
  tables: string[],
  query: (db: DbLike) => Promise<T>,
  deps: unknown[] = []
): LiveQueryResult<T> {
  const { db, isReady } = useDatabase();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const queryRef = useRef(query);
  queryRef.current = query;

  const runIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const runQuery = useCallback(async () => {
    if (!db || !isReady) {
      return;
    }

    const currentRunId = ++runIdRef.current;

    try {
      const result = await queryRef.current(db);
      if (isMountedRef.current && currentRunId === runIdRef.current) {
        setData(result);
        setError(null);
        setLoading(false);
      }
    } catch (err: unknown) {
      if (isMountedRef.current && currentRunId === runIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, [db, isReady]);

  // Execute on mount and whenever db, isReady, or external deps change
  useEffect(() => {
    isMountedRef.current = true;
    void runQuery();

    return () => {
      // Invalidation handled by runIdRef
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQuery, ...deps]);

  // Subscribe to table changes
  const tableKey = tables.slice().sort().join(',');
  useEffect(() => {
    if (tables.length === 0) return;

    const unsubscribe = subscribeTableChange(tables, () => {
      setLoading(true);
      void runQuery();
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, runQuery]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      runIdRef.current++;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await runQuery();
  }, [runQuery]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
