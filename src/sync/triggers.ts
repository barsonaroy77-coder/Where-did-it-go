import { AppState, AppStateStatus } from 'react-native';
import { DbLike } from '@/db/types';
import { runSync, SyncSummary } from './engine';
import { SyncRemote, defaultSyncRemote } from './remote';

export interface SyncTriggerOptions {
  remote?: SyncRemote;
  onSyncComplete?: (summary: SyncSummary) => void;
}

/**
 * Subscribes to application lifecycle events (PRD 8.5) to trigger synchronization
 * when the app transitions back to the foreground ('active').
 * Minimal trigger without third-party network detection dependencies.
 */
export function setupAppStateSyncTrigger(
  getDb: () => DbLike | null,
  getUserId: () => string | null,
  options?: SyncTriggerOptions
): () => void {
  const remote = options?.remote ?? defaultSyncRemote;

  const handleAppStateChange = (nextStatus: AppStateStatus) => {
    if (nextStatus === 'active') {
      const db = getDb();
      const userId = getUserId();
      if (db && userId) {
        runSync(db, userId, remote)
          .then((summary) => {
            if (options?.onSyncComplete) {
              options.onSyncComplete(summary);
            }
          })
          .catch(() => {
            // runSync never throws, but keep safety boundary
          });
      }
    }
  };

  const subscription = AppState.addEventListener('change', handleAppStateChange);

  return () => {
    subscription.remove();
  };
}
