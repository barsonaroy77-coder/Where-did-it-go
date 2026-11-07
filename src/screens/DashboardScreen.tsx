import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, useToast } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';
import { useAuth } from '@/hooks/useAuth';
import { useDatabase, runDbSmokeTest } from '@/db';
import { createTransaction } from '@/db/repositories/transactions';
import { runSync, getSyncCounts, SyncCounts, SyncSummary } from '@/sync';

/**
 * Dashboard Screen (Phase 3 Part 4 & Phase 4 Part 6).
 * Rendered when a user is authenticated.
 * Displays title, sync prototype DEV UI (__DEV__), DB smoke test button, and sign out button.
 */
export const DashboardScreen: React.FC = () => {
  const { user, signOut } = useAuth();
  const { db } = useDatabase();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [syncCounts, setSyncCounts] = useState<SyncCounts>({ pending: 0, blocked: 0, failed: 0 });
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);

  const refreshCounts = useCallback(async () => {
    if (!db) return;
    try {
      const counts = await getSyncCounts(db);
      setSyncCounts(counts);
    } catch {
      // Ignore count fetch errors
    }
  }, [db]);

  useEffect(() => {
    let isMounted = true;
    if (db) {
      getSyncCounts(db).then((counts) => {
        if (isMounted) {
          setSyncCounts(counts);
        }
      }).catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [db]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSmokeTest = async () => {
    setIsRunningSmokeTest(true);
    try {
      const result = await runDbSmokeTest();
      if (result.ok) {
        showToast({
          message: 'Smoke test passed',
          variant: 'success',
        });
      } else {
        showToast({
          message: `Smoke test failed: ${result.step}`,
          variant: 'error',
        });
      }
    } catch {
      showToast({
        message: 'Smoke test failed',
        variant: 'error',
      });
    } finally {
      setIsRunningSmokeTest(false);
    }
  };

  const handleSyncNow = async () => {
    if (!db || !user?.id) {
      showToast({ message: 'Database not ready', variant: 'error' });
      return;
    }

    setIsSyncing(true);
    try {
      const summary = await runSync(db, user.id);
      setLastSummary(summary);
      await refreshCounts();

      if (summary.stoppedBecause === 'paused') {
        showToast({ message: 'Sync paused', variant: 'error' });
      } else if (summary.stoppedBecause === 'network_error') {
        showToast({ message: 'Network offline. Retrying later.', variant: 'error' });
      } else if (summary.stoppedBecause === 'auth_error') {
        showToast({ message: 'Session expired. Please sign in.', variant: 'error' });
      } else {
        showToast({
          message: `Sync finished: ${summary.pushed} pushed, ${summary.pulled} pulled`,
          variant: 'success',
        });
      }
    } catch {
      showToast({ message: 'Sync failed unexpectedly', variant: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddTestExpense = async () => {
    if (!db || !user?.id) {
      showToast({ message: 'Database not ready', variant: 'error' });
      return;
    }

    setIsAddingExpense(true);
    try {
      // Find the first non-archived, non-deleted expense category
      const category = await db.getFirstAsync<{ id: string; name: string }>(
        "SELECT id, name FROM categories WHERE type = 'expense' AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1;"
      );

      if (!category) {
        showToast({
          message: 'No expense category found. Please sync first to pull categories.',
          variant: 'error',
        });
        return;
      }

      // Create a small expense of 450 units (e.g. $4.50 stored as safe integer)
      const today = new Date().toISOString().slice(0, 10);
      const res = await createTransaction(db, {
        type: 'expense',
        amount: 450,
        category_id: category.id,
        date: today,
        note: 'Test coffee expense',
      });

      if (res.ok) {
        showToast({
          message: `Test expense added in '${category.name}'`,
          variant: 'success',
        });
        await refreshCounts();
      } else {
        showToast({
          message: `Failed to add expense: ${res.error}`,
          variant: 'error',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ message: `Error adding expense: ${msg}`, variant: 'error' });
    } finally {
      setIsAddingExpense(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: (insets?.top ?? 0) + spacing.md,
          paddingBottom: (insets?.bottom ?? 0) + spacing.md,
        },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
        </View>

        {__DEV__ ? (
          <View style={styles.devSection}>
            <Card title="Sync Prototype (DEV)">
              <View style={styles.countsContainer}>
                <View style={styles.countBadge}>
                  <Text style={styles.countLabel}>Pending</Text>
                  <Text style={styles.countValue}>{syncCounts.pending}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countLabel}>Blocked</Text>
                  <Text style={styles.countValue}>{syncCounts.blocked}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countLabel}>Failed</Text>
                  <Text style={styles.countValue}>{syncCounts.failed}</Text>
                </View>
              </View>

              {lastSummary ? (
                <View style={styles.summaryContainer}>
                  <Text style={styles.summaryTitle}>Last Sync Summary:</Text>
                  <Text style={styles.summaryText}>
                    Pushed: {lastSummary.pushed} | Pulled: {lastSummary.pulled} | Blocked: {lastSummary.blocked} | Failed: {lastSummary.failed}
                  </Text>
                  {lastSummary.stoppedBecause ? (
                    <Text style={styles.summaryStopped}>
                      Status: {lastSummary.stoppedBecause}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.buttonRow}>
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={isSyncing}
                  disabled={isSyncing || isAddingExpense || isSigningOut}
                  onPress={handleSyncNow}
                  title="Sync now"
                  style={styles.actionBtn}
                />
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  loading={isAddingExpense}
                  disabled={isSyncing || isAddingExpense || isSigningOut}
                  onPress={handleAddTestExpense}
                  title="Add test expense"
                  style={styles.actionBtn}
                />
              </View>
            </Card>

            <View style={styles.smokeTestWrapper}>
              <Button
                variant="secondary"
                size="md"
                fullWidth
                loading={isRunningSmokeTest}
                disabled={isRunningSmokeTest || isSigningOut || isSyncing}
                onPress={handleSmokeTest}
                title="Run DB smoke test"
              />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="danger"
          size="lg"
          fullWidth
          loading={isSigningOut}
          disabled={isSigningOut || isRunningSmokeTest || isSyncing}
          onPress={handleSignOut}
          title="Sign Out"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
  },
  header: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['3xl'],
    lineHeight: lineHeights['3xl'],
    color: colors.text,
  },
  devSection: {
    marginBottom: spacing.lg,
  },
  countsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  countBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 2,
  },
  countLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  countValue: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    color: colors.text,
  },
  summaryContainer: {
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  summaryTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.text,
    marginBottom: 2,
  },
  summaryText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.text,
  },
  summaryStopped: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.negative,
    marginTop: 2,
  },
  buttonRow: {
    gap: spacing.sm,
  },
  actionBtn: {
    marginBottom: spacing.xs,
  },
  smokeTestWrapper: {
    marginTop: spacing.md,
  },
  footer: {
    marginBottom: spacing.md,
  },
});
