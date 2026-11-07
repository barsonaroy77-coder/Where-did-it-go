import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';
import { useAuth } from '@/hooks/useAuth';

/**
 * Placeholder Dashboard Screen (Phase 3 Part 4).
 * Rendered when a user is authenticated.
 * Displays only the title and the sign-out button using existing tokens and components.
 */
export const DashboardScreen: React.FC = () => {
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: (insets?.top ?? 0) + spacing.xl,
          paddingBottom: (insets?.bottom ?? 0) + spacing.xl,
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Dashboard</Text>
      </View>

      <View style={styles.footer}>
        <Button
          variant="danger"
          size="lg"
          fullWidth
          loading={isSigningOut}
          disabled={isSigningOut}
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
    justifyContent: 'space-between',
  },
  content: {
    marginTop: spacing.xxl,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['3xl'],
    lineHeight: lineHeights['3xl'],
    color: colors.text,
  },
  footer: {
    marginBottom: spacing.md,
  },
});
