import React from 'react';
import { StyleSheet, Text, ScrollView } from 'react-native';
import { EmptyState } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';

export default function GoalsTabRoute() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Goals</Text>
      <EmptyState
        title="No goals yet"
        message="Create and track monthly savings goals here."
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
