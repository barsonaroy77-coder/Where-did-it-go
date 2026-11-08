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
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import {
  colors,
  fonts,
  fontSizes,
  borderWidths,
  radii,
  spacing,
  shadowOffsets,
} from '@/theme';
import {
  HomeIcon,
  ReceiptIcon,
  FlagIcon,
  ChartIcon,
  PlusIcon,
} from './icons';

const PRESS_DURATION = 60;

interface TabConfig {
  name: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}

const TAB_CONFIGS: Record<string, TabConfig> = {
  index: {
    name: 'index',
    label: 'HOME',
    Icon: HomeIcon,
  },
  transactions: {
    name: 'transactions',
    label: 'TRANSACT',
    Icon: ReceiptIcon,
  },
  goals: {
    name: 'goals',
    label: 'GOALS',
    Icon: FlagIcon,
  },
  insights: {
    name: 'insights',
    label: 'INSIGHTS',
    Icon: ChartIcon,
  },
};

interface TabButtonProps {
  config: TabConfig;
  isFocused: boolean;
  onPress: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ config, isFocused, onPress }) => {
  const [pressAnim] = useState(() => new Animated.Value(0));

  const handlePressIn = () => {
    Animated.timing(pressAnim, {
      toValue: 1,
      duration: PRESS_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(pressAnim, {
      toValue: 0,
      duration: PRESS_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const translateY = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 2],
  });

  const { Icon, label } = config;
  const activeColor = colors.text;
  const inactiveColor = colors.textMuted;
  const tint = isFocused ? activeColor : inactiveColor;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} tab`}
      accessibilityState={{ selected: isFocused }}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.tabButton}
    >
      <Animated.View
        style={[
          styles.tabContent,
          {
            transform: [{ translateY }],
          },
        ]}
      >
        <Icon size={22} color={tint} strokeWidth={isFocused ? 2.2 : 1.8} />
        <Text style={[styles.tabLabel, { color: tint }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
};

interface CenterAddButtonProps {
  onPress: () => void;
}

const CenterAddButton: React.FC<CenterAddButtonProps> = ({ onPress }) => {
  const [pressAnim] = useState(() => new Animated.Value(0));

  const handlePressIn = () => {
    Animated.timing(pressAnim, {
      toValue: 1,
      duration: PRESS_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(pressAnim, {
      toValue: 0,
      duration: PRESS_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const translateX = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shadowOffsets.sm.width],
  });

  const translateY = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shadowOffsets.sm.height],
  });

  return (
    <View style={styles.centerAddWrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.centerAddTouchTarget}
      >
        {/* Hard shadow underlay */}
        <View style={styles.centerAddShadow} />

        {/* Button face */}
        <Animated.View
          style={[
            styles.centerAddFace,
            {
              transform: [{ translateX }, { translateY }],
            },
          ]}
        >
          <PlusIcon size={28} color={colors.text} strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
    </View>
  );
};

/**
 * Custom Tab Bar for Where Did It Go?
 * Implements 4 tabs (Home, Transactions, Goals, Insights) with the
 * big yellow "+" Add button in the center.
 */
export const AppTabBar: React.FC<BottomTabBarProps> = ({
  state,
  navigateToTab,
  emitter,
}) => {
  const insets = useSafeAreaInsets();

  const handleAddPress = () => {
    router.push('/add');
  };

  // Divide the 4 tabs: 2 on the left, 2 on the right
  const leftRouteNames = ['index', 'transactions'];
  const rightRouteNames = ['goals', 'insights'];

  const renderTab = (routeName: string) => {
    const routeIndex = state.routes.findIndex((r: { name: string }) => r.name === routeName);
    if (routeIndex === -1) {
      return null;
    }

    const route = state.routes[routeIndex];
    const isFocused = state.index === routeIndex;
    const config = TAB_CONFIGS[routeName];
    if (!config) {
      return null;
    }

    const onPress = () => {
      const event = emitter.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigateToTab(route.key);
      }
    };

    return (
      <TabButton
        key={route.key}
        config={config}
        isFocused={isFocused}
        onPress={onPress}
      />
    );
  };

  return (
    <View
      style={[
        styles.barContainer,
        {
          paddingBottom: Math.max(insets.bottom, spacing.xs),
        },
      ]}
    >
      <View style={styles.tabsRow}>
        {leftRouteNames.map(renderTab)}
        <CenterAddButton onPress={handleAddPress} />
        {rightRouteNames.map(renderTab)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  barContainer: {
    backgroundColor: colors.background,
    borderTopWidth: borderWidths.regular,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 56,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs, // 12px (minimum text size requirement)
    letterSpacing: 0.5,
    marginTop: 3,
  },
  centerAddWrapper: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerAddTouchTarget: {
    position: 'relative',
    width: 52,
    height: 52,
  },
  centerAddShadow: {
    position: 'absolute',
    top: shadowOffsets.sm.height,
    left: shadowOffsets.sm.width,
    width: 52,
    height: 52,
    borderRadius: radii.full,
    backgroundColor: colors.border,
  },
  centerAddFace: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
