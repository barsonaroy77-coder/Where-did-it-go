import React from 'react';
import { StyleSheet, Text, View, StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, fontSizes, lineHeights, spacing, borderWidths, radii } from '@/theme';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onPress: () => void;
  };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Reusable Neobrutalist EmptyState component for screens and lists.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  icon,
  action,
  style,
  testID,
}) => {
  return (
    <View
      testID={testID}
      style={[styles.container, style]}
      accessibilityRole="none"
    >
      {icon ? <View style={styles.iconWrapper}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? (
        <Button
          variant="secondary"
          size="md"
          title={action.label}
          onPress={action.onPress}
          style={styles.actionButton}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginVertical: spacing.md,
  },
  iconWrapper: {
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 280,
  },
  actionButton: {
    marginTop: spacing.md,
  },
});
