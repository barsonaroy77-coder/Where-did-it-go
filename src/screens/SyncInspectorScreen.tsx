import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button, Card, useToast } from '@/components';
import {
  colors,
  borderWidths,
  fonts,
  fontSizes,
  lineHeights,
  spacing,
  radii,
} from '@/theme';
import { useAuth } from '@/hooks/useAuth';
import { useDatabase } from '@/db';
import { formatMinorUnits } from '@/lib/money';
import {
  createTransaction,
  updateTransaction,
  softDeleteTransaction,
} from '@/db/repositories/transactions';
import { runSync, SyncSummary } from '@/sync';
import { TransactionRow } from '@/db/types';

interface OutboxCounts {
  pending: number;
  in_flight: number;
  blocked: number;
  failed: number;
  conflicts: number;
}

interface PullCursor {
  table_name: string;
  last_change_seq: number;
  updated_at: string;
}

interface CategoryCounts {
  total: number;
  archived: number;
}

interface SyncErrorItem {
  id: number;
  code: string;
  message: string;
}

/**
 * Dev-Only Sync Inspector Screen (__DEV__ only).
 * Provides a live view of local sync metadata, outbox state, pull cursors,
 * categories, sync errors, and the 20 most recent transactions.
 * Rules: Never logs row notes or sensitive payloads.
 */
export const SyncInspectorScreen: React.FC = () => {
  const { user, profile } = useAuth();
  const { db } = useDatabase();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isDeletingExpense, setIsDeletingExpense] = useState(false);

  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [counts, setCounts] = useState<OutboxCounts>({
    pending: 0,
    in_flight: 0,
    blocked: 0,
    failed: 0,
    conflicts: 0,
  });
  const [pullCursors, setPullCursors] = useState<PullCursor[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCounts>({
    total: 0,
    archived: 0,
  });
  const [currencyDecimals, setCurrencyDecimals] = useState<number>(
    profile?.currency_decimals ?? 2
  );
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [syncErrors, setSyncErrors] = useState<SyncErrorItem[]>([]);

  const isBusy = isSyncing || isAddingExpense || isEditingNote || isDeletingExpense;

  const reloadData = useCallback(async () => {
    if (!db) {
      setLoadError('Database is not initialized.');
      setIsInitialLoading(false);
      return;
    }

    try {
      // 1. Outbox counts
      const outboxRows = await db.getAllAsync<{ status: string; count: number }>(
        'SELECT status, count(*) as count FROM outbox GROUP BY status;'
      );

      let pending = 0;
      let in_flight = 0;
      let blocked = 0;
      let failed = 0;

      for (const r of outboxRows) {
        if (r.status === 'pending') pending = r.count;
        if (r.status === 'in_flight') in_flight = r.count;
        if (r.status === 'blocked') blocked = r.count;
        if (r.status === 'failed') failed = r.count;
      }

      const conflictRow = await db.getFirstAsync<{ count: number }>(
        'SELECT count(*) as count FROM conflicts WHERE resolved_at IS NULL;'
      );
      const conflicts = conflictRow?.count ?? 0;

      setCounts({ pending, in_flight, blocked, failed, conflicts });

      // 2. Per-table pull cursors from sync_state_meta
      const cursors = await db.getAllAsync<PullCursor>(
        'SELECT table_name, last_change_seq, updated_at FROM sync_state_meta ORDER BY table_name ASC;'
      );
      setPullCursors(cursors);

      // 3. Categories count and archived count
      const catCountRow = await db.getFirstAsync<{ total: number; archived: number }>(
        `SELECT
           count(*) as total,
           coalesce(sum(case when archived_at is not null then 1 else 0 end), 0) as archived
         FROM categories
         WHERE deleted_at IS NULL;`
      );
      setCategoryCounts({
        total: catCountRow?.total ?? 0,
        archived: catCountRow?.archived ?? 0,
      });

      // 4. Currency decimals
      const profRow = await db.getFirstAsync<{ currency_decimals: number }>(
        'SELECT currency_decimals FROM profiles LIMIT 1;'
      );
      if (profRow?.currency_decimals !== undefined) {
        setCurrencyDecimals(profRow.currency_decimals);
      } else if (profile?.currency_decimals !== undefined) {
        setCurrencyDecimals(profile.currency_decimals);
      }

      // 5. 20 most recent transactions (by change_seq, then date, rowid)
      const txRows = await db.getAllAsync<TransactionRow>(
        `SELECT * FROM transactions
         ORDER BY change_seq DESC, date DESC, rowid DESC
         LIMIT 20;`
      );
      setTransactions(txRows);

      // 6. Last 10 sync_errors (code and message only)
      const errRows = await db.getAllAsync<SyncErrorItem>(
        'SELECT id, code, message FROM sync_errors ORDER BY id DESC LIMIT 10;'
      );
      setSyncErrors(errRows);

      setLoadError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    } finally {
      setIsInitialLoading(false);
    }
  }, [db, profile]);

  useEffect(() => {
    let isMounted = true;
    const fetchInspectorData = async () => {
      await reloadData();
    };
    if (isMounted) {
      void fetchInspectorData();
    }
    return () => {
      isMounted = false;
    };
  }, [reloadData]);

  const handleSyncNow = async () => {
    if (!db || !user?.id) {
      showToast({ message: 'Database or user session not ready', variant: 'error' });
      return;
    }

    setIsSyncing(true);
    try {
      const summary = await runSync(db, user.id);
      setLastSummary(summary);
      await reloadData();

      if (summary.stoppedBecause === 'paused') {
        showToast({ message: 'Sync paused', variant: 'error' });
      } else if (summary.stoppedBecause === 'network_error') {
        showToast({ message: 'Network offline. Retrying later.', variant: 'error' });
      } else if (summary.stoppedBecause === 'auth_error') {
        showToast({ message: 'Session expired. Please sign in.', variant: 'error' });
      } else if (summary.stoppedBecause) {
        showToast({ message: `Sync stopped: ${summary.stoppedBecause}`, variant: 'error' });
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
      const category = await db.getFirstAsync<{ id: string; name: string }>(
        "SELECT id, name FROM categories WHERE type = 'expense' AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1;"
      );

      if (!category) {
        showToast({
          message: 'No active expense category found. Please sync first.',
          variant: 'error',
        });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const res = await createTransaction(db, {
        type: 'expense',
        amount: 450,
        category_id: category.id,
        date: today,
        note: `Test expense ${new Date().toLocaleTimeString()}`,
      });

      if (res.ok) {
        showToast({ message: `Added test expense in '${category.name}'`, variant: 'success' });
        await reloadData();
      } else {
        showToast({ message: `Failed to add expense: ${res.error}`, variant: 'error' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ message: `Error adding expense: ${msg}`, variant: 'error' });
    } finally {
      setIsAddingExpense(false);
    }
  };

  const handleEditLastExpenseNote = async () => {
    if (!db) {
      showToast({ message: 'Database not ready', variant: 'error' });
      return;
    }

    setIsEditingNote(true);
    try {
      const newestTx = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY rowid DESC LIMIT 1;'
      );

      if (!newestTx) {
        showToast({ message: 'No active transaction to edit', variant: 'error' });
        return;
      }

      const updatedNote = `Edited note ${new Date().toLocaleTimeString()}`;
      const res = await updateTransaction(db, newestTx.id, {
        note: updatedNote,
      });

      if (res.ok) {
        showToast({ message: 'Updated last expense note', variant: 'success' });
        await reloadData();
      } else {
        showToast({ message: `Failed to edit note: ${res.error}`, variant: 'error' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ message: `Error editing expense: ${msg}`, variant: 'error' });
    } finally {
      setIsEditingNote(false);
    }
  };

  const handleDeleteLastExpense = async () => {
    if (!db) {
      showToast({ message: 'Database not ready', variant: 'error' });
      return;
    }

    setIsDeletingExpense(true);
    try {
      const newestTx = await db.getFirstAsync<TransactionRow>(
        'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY rowid DESC LIMIT 1;'
      );

      if (!newestTx) {
        showToast({ message: 'No active transaction to delete', variant: 'error' });
        return;
      }

      const res = await softDeleteTransaction(db, newestTx.id);

      if (res.ok) {
        showToast({ message: 'Soft-deleted last expense', variant: 'success' });
        await reloadData();
      } else {
        showToast({ message: `Failed to delete expense: ${res.error}`, variant: 'error' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ message: `Error deleting expense: ${msg}`, variant: 'error' });
    } finally {
      setIsDeletingExpense(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (!__DEV__) {
    return null;
  }

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: (insets?.top ?? 0) + spacing.sm,
          paddingBottom: (insets?.bottom ?? 0) + spacing.md,
        },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Button
            variant="secondary"
            size="sm"
            title="← Back"
            onPress={handleBack}
            style={styles.backButton}
          />
          <Text style={styles.title}>Sync Inspector</Text>
        </View>

        {isInitialLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.loadingText}>Loading sync metadata...</Text>
          </View>
        ) : loadError ? (
          <Card title="Error Loading Data">
            <Text style={styles.errorText}>{loadError}</Text>
            <Button
              variant="secondary"
              size="sm"
              title="Retry"
              onPress={reloadData}
              style={styles.retryButton}
            />
          </Card>
        ) : (
          <>
            {/* 1. Action Buttons */}
            <Card title="Actions" style={styles.cardSpacing}>
              <View style={styles.actionButtonsCol}>
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={isSyncing}
                  disabled={isBusy}
                  onPress={handleSyncNow}
                  title="Sync now"
                  style={styles.actionBtn}
                />
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  loading={isAddingExpense}
                  disabled={isBusy}
                  onPress={handleAddTestExpense}
                  title="Add test expense"
                  style={styles.actionBtn}
                />
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  loading={isEditingNote}
                  disabled={isBusy}
                  onPress={handleEditLastExpenseNote}
                  title="Edit last test expense note"
                  style={styles.actionBtn}
                />
                <Button
                  variant="danger"
                  size="md"
                  fullWidth
                  loading={isDeletingExpense}
                  disabled={isBusy}
                  onPress={handleDeleteLastExpense}
                  title="Delete last test expense"
                  style={styles.actionBtn}
                />
              </View>
            </Card>

            {/* 2. Counts: Pending, In Flight, Blocked, Failed, Unresolved Conflicts */}
            <Card title="Outbox & Conflicts" style={styles.cardSpacing}>
              <View style={styles.countsRow}>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeLabel}>Pending</Text>
                  <Text style={styles.countBadgeValue}>{counts.pending}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeLabel}>In Flight</Text>
                  <Text style={styles.countBadgeValue}>{counts.in_flight}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeLabel}>Blocked</Text>
                  <Text style={styles.countBadgeValue}>{counts.blocked}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeLabel}>Failed</Text>
                  <Text style={styles.countBadgeValue}>{counts.failed}</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeLabel}>Conflicts</Text>
                  <Text
                    style={[
                      styles.countBadgeValue,
                      counts.conflicts > 0 && styles.textNegative,
                    ]}
                  >
                    {counts.conflicts}
                  </Text>
                </View>
              </View>
            </Card>

            {/* 3. Pull Cursors from sync_state_meta */}
            <Card title="Pull Cursors (sync_state_meta)" style={styles.cardSpacing}>
              {pullCursors.length === 0 ? (
                <Text style={styles.emptyText}>No pull cursors found in sync_state_meta.</Text>
              ) : (
                pullCursors.map((cursor) => (
                  <View key={cursor.table_name} style={styles.cursorRow}>
                    <Text style={styles.cursorTableName}>{cursor.table_name}</Text>
                    <Text style={styles.cursorSeq}>
                      Last Seq: <Text style={styles.boldText}>{cursor.last_change_seq}</Text>
                    </Text>
                  </View>
                ))
              )}
            </Card>

            {/* 4. Categories Count & Archived Count */}
            <Card title="Categories" style={styles.cardSpacing}>
              <View style={styles.statLine}>
                <Text style={styles.statLabel}>Total Categories:</Text>
                <Text style={styles.statValue}>{categoryCounts.total}</Text>
              </View>
              <View style={styles.statLine}>
                <Text style={styles.statLabel}>Archived Categories:</Text>
                <Text style={styles.statValue}>{categoryCounts.archived}</Text>
              </View>
              <View style={styles.statLine}>
                <Text style={styles.statLabel}>Active Categories:</Text>
                <Text style={styles.statValue}>
                  {Math.max(0, categoryCounts.total - categoryCounts.archived)}
                </Text>
              </View>
            </Card>

            {/* 5. Last Sync Summary & Last 10 Sync Errors */}
            <Card title="Sync Summary & Errors" style={styles.cardSpacing}>
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionSubtitle}>Last Sync Summary</Text>
                {lastSummary ? (
                  <View style={styles.summaryBox}>
                    <Text style={styles.summaryText}>
                      Pushed: {lastSummary.pushed} | Pulled: {lastSummary.pulled} | Blocked:{' '}
                      {lastSummary.blocked} | Failed: {lastSummary.failed}
                    </Text>
                    {lastSummary.stoppedBecause ? (
                      <Text style={styles.summaryStopped}>
                        Stopped: {lastSummary.stoppedBecause}
                      </Text>
                    ) : (
                      <Text style={styles.summarySuccess}>Status: OK</Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>No sync run recorded in this session.</Text>
                )}
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionSubtitle}>Last 10 Sync Errors</Text>
                {syncErrors.length === 0 ? (
                  <Text style={styles.emptyText}>No sync errors recorded.</Text>
                ) : (
                  syncErrors.map((err) => (
                    <View key={err.id} style={styles.errorItem}>
                      <Text style={styles.errorCode}>[{err.code}]</Text>
                      <Text style={styles.errorMessage}>{err.message}</Text>
                    </View>
                  ))
                )}
              </View>
            </Card>

            {/* 6. 20 Most Recent Transactions */}
            <Card title="Transactions (20 Most Recent)" style={styles.cardSpacing}>
              {transactions.length === 0 ? (
                <Text style={styles.emptyText}>No transactions recorded yet.</Text>
              ) : (
                transactions.map((tx) => {
                  let formattedAmount = '';
                  try {
                    formattedAmount = formatMinorUnits(tx.amount, currencyDecimals);
                  } catch {
                    formattedAmount = String(tx.amount);
                  }

                  const isDeleted = tx.deleted_at !== null;

                  return (
                    <View key={tx.id} style={styles.txCard}>
                      <View style={styles.txTopRow}>
                        <Text
                          style={[
                            styles.txAmountText,
                            tx.type === 'expense' ? styles.textNegative : styles.textPositive,
                          ]}
                        >
                          {tx.type === 'expense' ? '-' : '+'}
                          {profile?.currency ? `${profile.currency} ` : ''}
                          {formattedAmount}
                        </Text>
                        <Text style={styles.txDateText}>{tx.date}</Text>
                      </View>

                      <View style={styles.txNoteRow}>
                        <Text style={styles.txNoteLabel}>Note:</Text>
                        <Text style={styles.txNoteText}>{tx.note ?? '(none)'}</Text>
                      </View>

                      <View style={styles.txMetaRow}>
                        <Text style={styles.txMetaText}>
                          sync_state: <Text style={styles.boldText}>{tx.sync_state}</Text> | v
                          {tx.version} | seq: {tx.change_seq} |{' '}
                          <Text
                            style={[
                              styles.boldText,
                              isDeleted ? styles.textNegative : styles.textPositive,
                            ]}
                          >
                            {isDeleted ? 'Deleted' : 'Active'}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  backButton: {
    marginRight: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.text,
  },
  cardSpacing: {
    marginBottom: spacing.md,
  },
  loadingContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.negative,
    marginBottom: spacing.sm,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  actionButtonsCol: {
    gap: spacing.xs,
  },
  actionBtn: {
    marginBottom: spacing.xs,
  },
  countsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  countBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: 2,
    backgroundColor: colors.background,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  countBadgeLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  countBadgeValue: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.md,
    color: colors.text,
    marginTop: 2,
  },
  textNegative: {
    color: colors.negative,
  },
  textPositive: {
    color: colors.positive,
  },
  boldText: {
    fontFamily: fonts.bold,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  cursorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cursorTableName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  cursorSeq: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  sectionBlock: {
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  summaryBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    borderRadius: radii.sm,
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
  summarySuccess: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.positive,
    marginTop: 2,
  },
  errorItem: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
  },
  errorCode: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.negative,
  },
  errorMessage: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.text,
    marginTop: 2,
  },
  txCard: {
    backgroundColor: colors.background,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  txTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  txAmountText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.md,
  },
  txDateText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  txNoteRow: {
    marginBottom: spacing.xs,
  },
  txNoteLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  txNoteText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  txMetaRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  txMetaText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
});
