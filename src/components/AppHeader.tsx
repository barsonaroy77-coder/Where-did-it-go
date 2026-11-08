import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { BottomTabHeaderProps } from 'expo-router/js-tabs';
import { colors, fonts, fontSizes, lineHeights, spacing, borderWidths, radii, shadowOffsets } from '@/theme';
import { SyncStatusChip } from './SyncStatusChip';
import { PersonIcon } from './icons';

const PRESS_ANIM_DURATION = 60;

/**
 * Custom App Header matching the dashboard mockups and design notes.
 * - App title: "Where Did It Go?"
 * - Small caps tagline: "NOW YOU KNOW." (min text size 12)
 * - Sync status chip
 * - Profile circle button opening /settings
 */
export const AppHeader: React.FC<BottomTabHeaderProps> = () => {
  const insets = useSafeAreaInsets();
  const [profilePressAnim] = useState(() => new Animated.Value(0));

  const handleProfilePressIn = () => {
    Animated.timing(profilePressAnim, {
      toValue: 1,
      duration: PRESS_ANIM_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const handleProfilePressOut = () => {
    Animated.timing(profilePressAnim, {
      toValue: 0,
      duration: PRESS_ANIM_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const translateX = profilePressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shadowOffsets.sm.width],
  });

  const translateY = profilePressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shadowOffsets.sm.height],
  });

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, spacing.sm) + spacing.xs,
        },
      ]}
    >
      <View style={styles.titleColumn}>
        <Text style={styles.appName}>Where Did It Go?</Text>
        <Text style={styles.tagline}>NOW YOU KNOW.</Text>
      </View>

      <View style={styles.rightActions}>
        <SyncStatusChip />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => router.push('/settings')}
          onPressIn={handleProfilePressIn}
          onPressOut={handleProfilePressOut}
          style={styles.profileWrapper}
        >
          <Animated.View
            style={[
              styles.profileCircle,
              {
                transform: [{ translateX }, { translateY }],
              },
            ]}
          >
            <PersonIcon size={18} color={colors.text} />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleColumn: {
    justifyContent: 'center',
  },
  appName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xl, // 20px
    lineHeight: lineHeights.xl,
    color: colors.text,
  },
  tagline: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs, // 12px (minimum text size requirement)
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileWrapper: {
    position: 'relative',
  },
  profileCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
