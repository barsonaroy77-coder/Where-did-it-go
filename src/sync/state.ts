export type SyncPausedReason = 'offline' | 'session_expired' | null;

let currentGlobalSyncPaused: SyncPausedReason = null;
let syncPausedListeners: ((reason: SyncPausedReason) => void)[] = [];

/**
 * Returns the module-level syncPaused reason so background sync routines
 * can inspect pause state without requiring React component rendering.
 */
export function getSyncPausedReason(): SyncPausedReason {
  return currentGlobalSyncPaused;
}

/**
 * Sets the module-level syncPaused state and notifies any active AuthProvider.
 */
export function setGlobalSyncPaused(reason: SyncPausedReason): void {
  currentGlobalSyncPaused = reason;
  for (const listener of [...syncPausedListeners]) {
    try {
      listener(reason);
    } catch {
      // Ignore listener errors
    }
  }
}

/**
 * Subscribes a listener to changes in the module-level syncPaused state.
 */
export function subscribeSyncPaused(
  listener: (reason: SyncPausedReason) => void
): () => void {
  syncPausedListeners.push(listener);
  return () => {
    syncPausedListeners = syncPausedListeners.filter((l) => l !== listener);
  };
}
