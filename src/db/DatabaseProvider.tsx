import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { SQLiteDatabase } from 'expo-sqlite';
import { useAuth } from '@/hooks/useAuth';
import { openDatabaseForUser, closeDatabase, logDatabaseDevStats } from './database';
import { runMigrations } from './migrate';
import { runSync, setupAppStateSyncTrigger } from '@/sync';

export interface DatabaseContextValue {
  db: SQLiteDatabase | null;
  isReady: boolean;
  error: Error | null;
}

export const DatabaseContext = createContext<DatabaseContextValue>({
  db: null,
  isReady: false,
  error: null,
});

export interface DatabaseProviderProps {
  children: React.ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const activeUserIdRef = useRef<string | null>(null);
  const lastLoggedVersionRef = useRef<number | null>(null);

  useEffect(() => {
    // Wait until auth state has finished its initial load
    if (authLoading) {
      return;
    }

    // When signed out: close database connection and reset state, retaining database file on disk
    if (!isAuthenticated || !user?.id) {
      activeUserIdRef.current = null;
      lastLoggedVersionRef.current = null;
      setDb(null);
      setIsReady(false);
      setError(null);
      closeDatabase().catch(() => {
        // Silently catch close errors
      });
      return;
    }

    const targetUserId = user.id;

    // Avoid duplicate initialization for the same user if already in progress or completed
    if (activeUserIdRef.current === targetUserId) {
      return;
    }

    activeUserIdRef.current = targetUserId;
    setIsReady(false);
    setError(null);

    let isCancelled = false;

    async function initializeUserDatabase() {
      try {
        const userDb = await openDatabaseForUser(targetUserId);
        const version = await runMigrations(userDb);

        if (isCancelled) {
          return;
        }

        setDb(userDb);
        setIsReady(true);
        setError(null);

        // Development-only check: logs table count and migration version once (no data, no user id)
        if (__DEV__ && lastLoggedVersionRef.current !== version) {
          lastLoggedVersionRef.current = version;
          await logDatabaseDevStats(userDb, version);
        }

        // Trigger 1: Run sync on app launch after the database is ready (PRD 8.5)
        runSync(userDb, targetUserId).catch(() => {});
      } catch (err: unknown) {
        if (isCancelled) {
          return;
        }
        activeUserIdRef.current = null;
        const initError =
          err instanceof Error ? err : new Error('Database initialization failed');
        setError(initError);
        setIsReady(false);
        if (__DEV__) {
          console.error('Database initialization failed');
        }
      }
    }

    initializeUserDatabase();

    return () => {
      isCancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.id]);

  // Trigger 2: Run sync when the app returns to the foreground (AppState) (PRD 8.5)
  useEffect(() => {
    if (!db || !user?.id) {
      return;
    }
    const unsubscribe = setupAppStateSyncTrigger(
      () => db,
      () => user.id
    );
    return unsubscribe;
  }, [db, user?.id]);

  const contextValue: DatabaseContextValue = {
    db,
    isReady,
    error,
  };

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
};

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return context;
}
