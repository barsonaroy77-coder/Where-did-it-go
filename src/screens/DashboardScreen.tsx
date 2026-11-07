import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, useToast } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';
import { useAuth } from '@/hooks/useAuth';
import { runDbSmokeTest } from '@/db';

/**
 * Placeholder Dashboard Screen (Phase 3 Part 4 & Phase 4 Part 5).
 * Rendered when a user is authenticated.
 * Displays only the title, the dev-only DB smoke test button, and the sign-out button
 * using existing tokens and components.
 */
export const DashboardScreen: React.FC = () => {
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);

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
        {__DEV__ ? (
          <View style={styles.devSection}>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              loading={isRunningSmokeTest}
              disabled={isRunningSmokeTest || isSigningOut}
              onPress={handleSmokeTest}
              title="Run DB smoke test"
            />
          </View>
        ) : null}

        <Button
          variant="danger"
          size="lg"
          fullWidth
          loading={isSigningOut}
          disabled={isSigningOut || isRunningSmokeTest}
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
  devSection: {
    marginBottom: spacing.md,
  },
  footer: {
    marginBottom: spacing.md,
  },
});
