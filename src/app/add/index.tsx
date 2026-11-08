import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { TransactionForm } from '@/components/transaction/TransactionForm';
import { colors } from '@/theme';

export default function AddModalRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
      <View style={styles.screen}>
        <TransactionForm
          mode="add"
          onSuccess={() => router.back()}
          onCancel={() => router.back()}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
