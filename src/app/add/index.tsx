import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { Button, EmptyState } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';

export default function AddModalRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Add Transaction',
          presentation: 'modal',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Add Transaction</Text>
          <Button
            variant="secondary"
            size="sm"
            title="Close"
            onPress={() => router.back()}
          />
        </View>
        <EmptyState
          title="New Transaction"
          message="Transaction entry form (amount, category, date, and natural language) will appear here."
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.text,
  },
});
