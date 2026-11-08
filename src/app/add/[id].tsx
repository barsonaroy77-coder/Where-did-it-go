import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useDatabase } from '@/db';
import { TransactionRow } from '@/db/types';
import { getTransaction } from '@/db/repositories/transactions';
import { useToast } from '@/components/Toast';
import { TransactionForm } from '@/components/transaction/TransactionForm';
import { colors } from '@/theme';

export default function EditModalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, isReady } = useDatabase();
  const toast = useToast();

  const [transaction, setTransaction] = useState<TransactionRow | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!isReady || !db || !id) {
        return;
      }

      try {
        const tx = await getTransaction(db, id);
        if (!isMounted) return;

        if (!tx || tx.deleted_at !== null) {
          toast.showToast({
            message: 'Transaction not found or deleted',
            variant: 'error',
          });
          router.back();
          return;
        }

        setTransaction(tx);
        setLoading(false);
      } catch {
        if (!isMounted) return;
        toast.showToast({
          message: 'Failed to load transaction',
          variant: 'error',
        });
        router.back();
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [id, db, isReady, toast]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
      <View style={styles.screen}>
        {loading || !transaction ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.border} />
          </View>
        ) : (
          <TransactionForm
            mode="edit"
            initialTransaction={transaction}
            onSuccess={() => router.back()}
            onCancel={() => router.back()}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
