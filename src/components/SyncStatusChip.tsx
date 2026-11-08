import React from 'react';
import { StyleSheet, Text, View, Pressable, StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, fontSizes, borderWidths, radii, spacing } from '@/theme';
import { SyncPausedReason } from '@/sync/state';
import { useAuth } from '@/hooks/useAuth';
import { useSyncCounts } from '@/hooks/useSyncCounts';

export interface SyncStatusCounts {
  pending: number;
  inFlight?: number;
  blocked: number;
  failed: number;
  unresolvedConflicts?: number;
}

export type SyncStatusText =
  | 'Synced'
  | `${number} pending`
  | 'Offline'
  | 'Needs attention';

/**
 * Pure function to determine sync status text according to PRD & architecture rules:
 * - If session is expired, or any mutations are blocked/failed, or unresolved conflicts exist -> "Needs attention"
 * - Else if pausedReason is 'offline' -> "Offline"
 * - Else if total pending mutations > 0 -> "N pending"
 * - Otherwise -> "Synced"
 */
export function getSyncStatus(
  counts: SyncStatusCounts,
  pausedReason: SyncPausedReason
): SyncStatusText {
  if (
    pausedReason === 'session_expired' ||
    (counts.blocked ?? 0) > 0 ||
    (counts.failed ?? 0) > 0 ||
    (counts.unresolvedConflicts ?? 0) > 0
  ) {
    return 'Needs attention';
  }

  if (pausedReason === 'offline') {
    return 'Offline';
  }

  const totalPending = (counts.pending ?? 0) + (counts.inFlight ?? 0);
  if (totalPending > 0) {
    return `${totalPending} pending`;
  }

  return 'Synced';
}

export interface SyncStatusChipProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Header Sync Status Chip:
 * Displays a pill containing a status dot and label ("Synced", "N pending", "Offline", "Needs attention").
 * Tapping it does nothing in Phase 5 Part 1.
 */
export const SyncStatusChip: React.FC<SyncStatusChipProps> = ({ style, testID }) => {
  const { counts } = useSyncCounts();
  const { syncPaused } = useAuth();

  const status = getSyncStatus(counts, syncPaused);

  let dotColor: string = colors.positive;
  if (status === 'Offline') {
    dotColor = colors.textMuted;
  } else if (status === 'Needs attention') {
    dotColor = colors.negative;
  } else if (status.endsWith('pending')) {
    dotColor = colors.accent;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${status}`}
      style={[styles.container, style]}
      onPress={undefined}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.text}>{status}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs, // 12px (minimum text size requirement)
    color: colors.text,
  },
});
