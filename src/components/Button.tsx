import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  GestureResponderEvent,
  PressableProps,
} from 'react-native';
import {
  colors,
  borderWidths,
  shadowOffsets,
  radii,
  fonts,
  fontSizes,
  lineHeights,
  spacing,
} from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title?: string;
  children?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const ANIMATION_DURATION_MS = 60;

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  title,
  children,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  contentStyle,
  textStyle,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  ...pressableProps
}) => {
  const pressAnim = useRef(new Animated.Value(0)).current;
  const isInteractive = !disabled && !loading;

  const handlePressIn = (event: GestureResponderEvent) => {
    if (isInteractive) {
      Animated.timing(pressAnim, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }).start();
    }
    pressableProps.onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (isInteractive) {
      Animated.timing(pressAnim, {
        toValue: 0,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }).start();
    }
    pressableProps.onPressOut?.(event);
  };

  const translateX = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [spacing.none, shadowOffsets.default.width],
  });

  const translateY = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [spacing.none, shadowOffsets.default.height],
  });

  // Variant styling
  const variantStyles = {
    primary: styles.variantPrimary,
    secondary: styles.variantSecondary,
    danger: styles.variantDanger,
  }[variant];

  const variantTextColors = {
    primary: colors.text,
    secondary: colors.text,
    danger: colors.white,
  }[variant];

  // Size styling
  const sizeStyles = {
    sm: styles.sizeSm,
    md: styles.sizeMd,
    lg: styles.sizeLg,
  }[size];

  const sizeTextStyles = {
    sm: styles.textSm,
    md: styles.textMd,
    lg: styles.textLg,
  }[size];

  const resolvedAccessibilityLabel =
    accessibilityLabel ?? (typeof children === 'string' ? children : title);

  return (
    <Pressable
      {...pressableProps}
      onPress={isInteractive ? onPress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: !isInteractive,
        busy: loading,
      }}
      style={[
        styles.wrapper,
        fullWidth ? styles.fullWidth : styles.inlineWrapper,
        disabled && styles.disabledWrapper,
        style,
      ]}
    >
      {/* Hard offset shadow underlay */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shadow,
          fullWidth && styles.fullWidth,
          disabled && styles.disabledShadow,
        ]}
      />

      {/* Button face that translates toward the shadow on press */}
      <Animated.View
        style={[
          styles.face,
          variantStyles,
          sizeStyles,
          fullWidth && styles.fullWidth,
          {
            transform: [{ translateX }, { translateY }],
          },
          contentStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variantTextColors}
            style={styles.spinner}
          />
        ) : title || typeof children === 'string' ? (
          <Text
            style={[
              styles.text,
              sizeTextStyles,
              { color: variantTextColors },
              textStyle,
            ]}
          >
            {title ?? children}
          </Text>
        ) : (
          children
        )}
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
  },
  inlineWrapper: {
    alignSelf: 'flex-start',
  },
  fullWidth: {
    width: '100%',
  },
  disabledWrapper: {
    opacity: 0.6,
  },
  shadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    width: '100%',
    height: '100%',
    backgroundColor: colors.border,
    borderRadius: radii.md,
  },
  disabledShadow: {
    backgroundColor: colors.textSecondary,
  },
  face: {
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  variantPrimary: {
    backgroundColor: colors.accent,
  },
  variantSecondary: {
    backgroundColor: colors.surface,
  },
  dangerText: {
    color: colors.white,
  },
  variantDanger: {
    backgroundColor: colors.negative,
  },
  sizeSm: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  sizeMd: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  sizeLg: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  text: {
    fontFamily: fonts.bold,
    textAlign: 'center',
  },
  textSm: {
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  textMd: {
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
  },
  textLg: {
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
  },
  spinner: {
    paddingVertical: spacing.xs,
  },
});

export default Button;
