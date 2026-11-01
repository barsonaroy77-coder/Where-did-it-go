import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
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

export type CardVariant = 'surface' | 'white' | 'cream';

export interface CardProps {
  children?: React.ReactNode;
  title?: string;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  variant = 'surface',
  style,
  contentStyle,
  titleStyle,
  accessibilityLabel,
  testID,
}) => {
  const isCream = variant === 'cream';

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? title}
      style={[styles.wrapper, style]}
    >
      {/* Hard offset shadow underlay */}
      <View pointerEvents="none" style={styles.shadow} />

      {/* Card surface */}
      <View
        style={[
          styles.surface,
          isCream ? styles.creamSurface : styles.whiteSurface,
          contentStyle,
        ]}
      >
        {title ? (
          <Text style={[styles.title, titleStyle]}>{title}</Text>
        ) : null}
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
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
  surface: {
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  whiteSurface: {
    backgroundColor: colors.surface,
  },
  creamSurface: {
    backgroundColor: colors.background,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
    marginBottom: spacing.sm,
  },
});

export default Card;
