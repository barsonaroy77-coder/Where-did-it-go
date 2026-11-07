import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  borderWidths,
  colors,
  fonts,
  fontSizes,
  lineHeights,
  radii,
  shadows,
  spacing,
} from '@/theme';
import { Button } from '@/components';
import { AuthCard } from '@/components/auth';
import { useAuth } from '@/hooks/useAuth';

export interface WelcomeScreenProps {
  onNavigateToDemo?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onNavigateToDemo,
}) => {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardContainer}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero & Logo Header */}
        <View style={styles.heroSection}>
          <View style={styles.badgeWrapper}>
            <View style={styles.titleBadge}>
              <Text style={styles.badgeText}>WHERE DID IT GO?</Text>
            </View>
          </View>

          <Text style={styles.tagline}>
            Track cash flow. Save with clarity. 100% offline-ready.
          </Text>

          {/* Feature Highlights */}
          <View style={styles.featuresRow}>
            <View style={styles.featurePill}>
              <Text style={styles.featurePillText}>⚡ Offline-First</Text>
            </View>
            <View style={styles.featurePill}>
              <Text style={styles.featurePillText}>🔒 Device-Secured</Text>
            </View>
            <View style={styles.featurePill}>
              <Text style={styles.featurePillText}>🎯 Zero Guilt</Text>
            </View>
          </View>
        </View>

        {/* Loading State */}
        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator size="large" color={colors.black} />
            <Text style={styles.stateCardTitle}>Checking Secure Session...</Text>
            <Text style={styles.stateCardBody}>
              Restoring session credentials from device secure storage.
            </Text>
          </View>
        ) : isAuthenticated && user ? (
          /* Returning User Session (PRD: Returning users with an existing session skip landing) */
          <View style={styles.sessionCard}>
            <View style={styles.sessionHeaderRow}>
              <View style={styles.statusIndicator} />
              <Text style={styles.sessionHeaderTitle}>ACTIVE SESSION DETECTED</Text>
            </View>

            <Text style={styles.sessionUserLabel}>Signed in as:</Text>
            <Text style={styles.sessionUserEmail} numberOfLines={1}>
              {user.email ?? 'Unknown User'}
            </Text>

            <View style={styles.phaseInfoBox}>
              <Text style={styles.phaseInfoText}>
                ✓ Auth & Secure Storage (Phase 3 active){'\n'}
                • Local SQLite & Sync engine integrate in Phase 4 & 6.
              </Text>
            </View>

            <View style={styles.sessionActions}>
              <Button
                variant="danger"
                size="md"
                fullWidth
                loading={isSigningOut}
                disabled={isSigningOut}
                onPress={handleSignOut}
                title="Sign Out"
              />

              {onNavigateToDemo && (
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  onPress={onNavigateToDemo}
                  title="View Style Guide Demo"
                  style={styles.demoButton}
                />
              )}
            </View>
          </View>
        ) : (
          /* Unauthenticated Landing / Auth Form */
          <>
            <AuthCard />
            {__DEV__ && onNavigateToDemo && (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onPress={onNavigateToDemo}
                title="View Style Guide Demo (Dev Only)"
                style={styles.demoButton}
              />
            )}
          </>
        )}

        {/* Footer info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Where Did It Go? • Neobrutalist Offline Tracker
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  badgeWrapper: {
    marginBottom: spacing.sm,
  },
  titleBadge: {
    backgroundColor: colors.accent,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.default,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.black,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  featuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  featurePill: {
    backgroundColor: colors.white,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingVertical: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    ...shadows.sm,
  },
  featurePillText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.black,
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.default,
  },
  stateCardTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    color: colors.text,
  },
  stateCardBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    ...shadows.default,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: radii.full,
    backgroundColor: colors.positive,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionHeaderTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.positive,
    letterSpacing: 0.5,
  },
  sessionUserLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  sessionUserEmail: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    color: colors.text,
    marginBottom: spacing.md,
  },
  phaseInfoBox: {
    backgroundColor: colors.background,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  phaseInfoText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    lineHeight: lineHeights.sm,
  },
  sessionActions: {
    gap: spacing.sm,
  },
  demoButton: {
    marginTop: spacing.xs,
  },
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
});
