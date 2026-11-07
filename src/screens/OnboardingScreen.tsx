import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, useToast } from '@/components';
import {
  colors,
  fonts,
  fontSizes,
  lineHeights,
  spacing,
} from '@/theme';
import { useAuth } from '@/hooks/useAuth';
import { SUPPORTED_CURRENCIES, getCurrency } from '@/lib/currencies';
import { createProfile } from '@/lib/profile';

/**
 * Onboarding Screen (Phase 3 Part 5).
 * PRD v4.0 Section 5.2:
 * Choose one supported currency during onboarding.
 * Currency selection applies to the entire account.
 * v1 does not perform exchange-rate conversion.
 * Currency may be changed only before any financial records exist.
 */
export const OnboardingScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { setProfile } = useAuth();

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [offlineError, setOfflineError] = useState<string | null>(() => {
    // Check initial connectivity if available in runtime environment
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
      return 'First setup requires an active internet connection. Please connect to the internet to complete setup.';
    }
    return null;
  });

  const selectedCurrency = selectedCode ? getCurrency(selectedCode) : null;

  const handleContinue = async () => {
    if (!selectedCode || isSaving) return;

    setIsSaving(true);
    setOfflineError(null);

    try {
      const result = await createProfile(selectedCode);

      if (result.error) {
        if (result.error.code === 'offline') {
          const message =
            'First setup requires an active internet connection. Please check your connectivity and try again.';
          setOfflineError(message);
          showToast({
            message,
            variant: 'error',
          });
        } else {
          showToast({
            message: result.error.message || 'Failed to save account currency. Please try again.',
            variant: 'error',
          });
        }
        return;
      }

      if (result.data) {
        // Profile successfully created/loaded
        setProfile(result.data);
        // Expo Router's Stack.Protected route guard in _layout.tsx will route to the dashboard placeholder
      }
    } catch {
      showToast({
        message: 'An unexpected error occurred while saving your currency.',
        variant: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: (insets?.top ?? 0) + spacing.lg,
          paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with Title and One-line Explanation */}
        <View style={styles.header}>
          <Text style={styles.title}>Choose your currency</Text>
          <Text style={styles.explanation}>
            This currency applies to your entire account and can only be changed before any financial records exist.
          </Text>
        </View>

        {/* Offline Warning Banner */}
        {offlineError ? (
          <Card style={styles.offlineCard}>
            <Text style={styles.offlineTitle}>Internet Required</Text>
            <Text style={styles.offlineBody}>{offlineError}</Text>
          </Card>
        ) : null}

        {/* Currency Picker: List of Chips */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Supported Currencies</Text>
          <View style={styles.chipList}>
            {SUPPORTED_CURRENCIES.map((item) => {
              const isSelected = selectedCode === item.code;
              return (
                <Chip
                  key={item.code}
                  label={`${item.code} (${item.symbol})  ·  ${item.name}`}
                  selected={isSelected}
                  onPress={() => {
                    setSelectedCode(item.code);
                    setOfflineError(null);
                  }}
                  style={styles.currencyChip}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, currency code ${item.code}`}
                  accessibilityHint="Selects this currency for your account"
                />
              );
            })}
          </View>
        </View>

        {/* Selected Currency Summary Card */}
        {selectedCurrency ? (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryCode}>
                {selectedCurrency.code} ({selectedCurrency.symbol})
              </Text>
              <Text style={styles.summaryDecimals}>
                {selectedCurrency.decimals === 0
                  ? '0 decimals (minor unit 0)'
                  : `${selectedCurrency.decimals} decimal places`}
              </Text>
            </View>
            <Text style={styles.summaryName}>{selectedCurrency.name}</Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* Footer with Continue Button */}
      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          title="Continue"
          disabled={!selectedCode || isSaving}
          loading={isSaving}
          onPress={handleContinue}
          accessibilityLabel="Continue with selected currency"
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
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  header: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['3xl'],
    lineHeight: lineHeights['3xl'],
    color: colors.text,
    marginBottom: spacing.xs,
  },
  explanation: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.textSecondary,
  },
  offlineCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  offlineTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.negative,
    marginBottom: spacing.xs,
  },
  offlineBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.text,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipList: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  currencyChip: {
    alignSelf: 'stretch',
    width: '100%',
  },
  summaryCard: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  summaryCode: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
  },
  summaryDecimals: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
  },
  summaryName: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
  },
  footer: {
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
});
