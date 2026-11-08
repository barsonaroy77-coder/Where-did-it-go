import React from 'react';
import { StyleSheet, Text, ScrollView } from 'react-native';
import { EmptyState } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';

export default function TransactionsTabRoute() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Transactions</Text>
      <EmptyState
        title="No transactions yet"
        message="Search, filter, and review all recorded transactions here."
      />
    </ScrollView>
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
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.text,
    marginBottom: spacing.sm,
  },
});
