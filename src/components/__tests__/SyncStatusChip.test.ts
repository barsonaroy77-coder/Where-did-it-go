jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ syncPaused: null }),
}));
jest.mock('@/hooks/useSyncCounts', () => ({
  useSyncCounts: () => ({
    counts: { pending: 0, blocked: 0, failed: 0, unresolvedConflicts: 0 },
  }),
}));

import { getSyncStatus, SyncStatusCounts } from '../SyncStatusChip';

describe('getSyncStatus', () => {
  const baseCounts: SyncStatusCounts = {
    pending: 0,
    blocked: 0,
    failed: 0,
    unresolvedConflicts: 0,
  };

  test('returns "Synced" when all counts are 0 and no pause reason', () => {
    expect(getSyncStatus(baseCounts, null)).toBe('Synced');
  });

  test('returns "N pending" when pending count > 0', () => {
    expect(getSyncStatus({ ...baseCounts, pending: 1 }, null)).toBe('1 pending');
    expect(getSyncStatus({ ...baseCounts, pending: 5 }, null)).toBe('5 pending');
  });

  test('includes inFlight in pending total', () => {
    expect(getSyncStatus({ ...baseCounts, pending: 2, inFlight: 1 }, null)).toBe('3 pending');
  });

  test('returns "Offline" when pausedReason is offline and no errors', () => {
    expect(getSyncStatus(baseCounts, 'offline')).toBe('Offline');
    // Even if pending items exist, offline status informs user of connectivity
    expect(getSyncStatus({ ...baseCounts, pending: 3 }, 'offline')).toBe('Offline');
  });

  test('returns "Needs attention" when session is expired', () => {
    expect(getSyncStatus(baseCounts, 'session_expired')).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, pending: 2 }, 'session_expired')).toBe('Needs attention');
  });

  test('returns "Needs attention" when blocked mutations exist', () => {
    expect(getSyncStatus({ ...baseCounts, blocked: 1 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, blocked: 2, pending: 3 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, blocked: 1 }, 'offline')).toBe('Needs attention');
  });

  test('returns "Needs attention" when failed mutations exist', () => {
    expect(getSyncStatus({ ...baseCounts, failed: 1 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, failed: 2, pending: 1 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, failed: 1 }, 'offline')).toBe('Needs attention');
  });

  test('returns "Needs attention" when unresolved conflicts exist', () => {
    expect(getSyncStatus({ ...baseCounts, unresolvedConflicts: 1 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, unresolvedConflicts: 2, pending: 4 }, null)).toBe('Needs attention');
    expect(getSyncStatus({ ...baseCounts, unresolvedConflicts: 1 }, 'offline')).toBe('Needs attention');
  });
});
