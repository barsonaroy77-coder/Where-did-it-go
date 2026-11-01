import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  View,
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

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  label?: string;
  children?: React.ReactNode;
  selected?: boolean;
  color?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const ANIMATION_DURATION_MS = 60;

/**
 * Determine if a hex color is dark to choose appropriate text contrast.
 */
function isDarkColor(hexColor?: string): boolean {
  if (!hexColor || !hexColor.startsWith('#')) return false;
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6 && hex.length !== 3) return false;
  const fullHex = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.45;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  children,
  selected = false,
  color,
  disabled = false,
  icon,
  style,
  contentStyle,
  textStyle,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  ...pressableProps
}) => {
  const pressAnim = useRef(new Animated.Value(0)).current;
  const isInteractive = !disabled;

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
    outputRange: [spacing.none, shadowOffsets.sm.width],
  });

  const translateY = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [spacing.none, shadowOffsets.sm.height],
  });

  const resolvedAccessibilityLabel =
    accessibilityLabel ?? (typeof children === 'string' ? children : label);

  // Background color: selected uses custom color or theme accent; unselected uses surface white
  const selectedBgColor = color ?? colors.accent;
  const backgroundColor = selected ? selectedBgColor : colors.surface;

  // Text color: dark background gets white text for readability; default is black text
  const isSelectedDark = selected && isDarkColor(color);
  const textColor = isSelectedDark ? colors.white : colors.text;

  const displayContent = label ?? children;

  return (
    <Pressable
      {...pressableProps}
      testID={testID}
      onPress={isInteractive ? onPress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        selected: Boolean(selected),
        disabled: !isInteractive,
      }}
      style={[
        styles.wrapper,
        disabled && styles.disabledWrapper,
        style,
      ]}
    >
      {/* Hard offset shadow underlay */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shadow,
          disabled && styles.disabledShadow,
        ]}
      />

      {/* Chip face translating toward shadow on press */}
      <Animated.View
        style={[
          styles.face,
          { backgroundColor },
          {
            transform: [{ translateX }, { translateY }],
          },
          contentStyle,
        ]}
      >
        {/* Optional custom icon or unselected color swatch dot */}
        {icon ? (
          icon
        ) : color && !selected ? (
          <View
            style={[
              styles.colorDot,
              { backgroundColor: color },
            ]}
          />
        ) : null}

        {typeof displayContent === 'string' ? (
          <Text
            style={[
              styles.text,
              { color: textColor },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {displayContent}
          </Text>
        ) : (
          displayContent
        )}
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
    marginRight: shadowOffsets.sm.width,
    marginBottom: shadowOffsets.sm.height,
  },
  disabledWrapper: {
    opacity: 0.5,
  },
  shadow: {
    position: 'absolute',
    top: shadowOffsets.sm.height,
    left: shadowOffsets.sm.width,
    right: -shadowOffsets.sm.width,
    bottom: -shadowOffsets.sm.height,
    backgroundColor: colors.border,
    borderRadius: radii.full,
  },
  disabledShadow: {
    backgroundColor: colors.textSecondary,
  },
  face: {
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing[3],
    gap: spacing.xs,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    textAlign: 'center',
  },
});

export default Chip;
