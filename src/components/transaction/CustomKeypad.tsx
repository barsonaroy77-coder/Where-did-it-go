import React from 'react';
import {
  Pressable,
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
  shadowOffsets,
  spacing,
} from '@/theme';

interface KeypadKeyProps {
  label: React.ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  isBackspace?: boolean;
}

const KeypadKey: React.FC<KeypadKeyProps> = ({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  isBackspace = false,
}) => {
  return (
    <View style={styles.keyWrapper}>
      {/* Hard offset shadow underlay */}
      <View
        style={[
          styles.keyShadow,
          disabled && styles.disabledShadow,
        ]}
      />

      {/* Interactive key face translating toward shadow when pressed */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.keyFace,
          isBackspace && styles.backspaceFace,
          disabled && styles.disabledFace,
          pressed && !disabled && styles.keyFacePressed,
        ]}
      >
        {typeof label === 'string' ? (
          <Text
            style={[
              styles.keyText,
              isBackspace && styles.backspaceText,
              disabled && styles.disabledText,
            ]}
            maxFontSizeMultiplier={1.5}
          >
            {label}
          </Text>
        ) : (
          label
        )}
      </Pressable>
    </View>
  );
};

export interface CustomKeypadProps {
  onKeyPress: (key: string) => void;
  decimals: number;
}

const DIGIT_LABELS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

export const CustomKeypad: React.FC<CustomKeypadProps> = ({
  onKeyPress,
  decimals,
}) => {
  const allowDecimals = decimals > 0;

  return (
    <View style={styles.container} accessibilityRole="none">
      {/* Row 1 */}
      <View style={styles.row}>
        {['1', '2', '3'].map((d) => (
          <KeypadKey
            key={d}
            label={d}
            accessibilityLabel={DIGIT_LABELS[d]}
            onPress={() => onKeyPress(d)}
          />
        ))}
      </View>

      {/* Row 2 */}
      <View style={styles.row}>
        {['4', '5', '6'].map((d) => (
          <KeypadKey
            key={d}
            label={d}
            accessibilityLabel={DIGIT_LABELS[d]}
            onPress={() => onKeyPress(d)}
          />
        ))}
      </View>

      {/* Row 3 */}
      <View style={styles.row}>
        {['7', '8', '9'].map((d) => (
          <KeypadKey
            key={d}
            label={d}
            accessibilityLabel={DIGIT_LABELS[d]}
            onPress={() => onKeyPress(d)}
          />
        ))}
      </View>

      {/* Row 4 */}
      <View style={styles.row}>
        <KeypadKey
          label="."
          accessibilityLabel="decimal point"
          onPress={() => onKeyPress('.')}
          disabled={!allowDecimals}
        />
        <KeypadKey
          label="0"
          accessibilityLabel={DIGIT_LABELS['0']}
          onPress={() => onKeyPress('0')}
        />
        <KeypadKey
          label="⌫"
          accessibilityLabel="delete last digit"
          onPress={() => onKeyPress('backspace')}
          isBackspace
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.sm,
  },
  keyWrapper: {
    flex: 1,
    height: 52,
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
  },
  keyShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.md,
  },
  disabledShadow: {
    backgroundColor: '#CCCCCC',
  },
  keyFace: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  keyFacePressed: {
    transform: [
      { translateX: shadowOffsets.default.width },
      { translateY: shadowOffsets.default.height },
    ],
  },
  backspaceFace: {
    backgroundColor: '#FEE2E2', // Neobrutalist soft red
  },
  disabledFace: {
    backgroundColor: '#F5F5F5',
    borderColor: '#CCCCCC',
  },
  keyText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xl,
    lineHeight: lineHeights.xl,
    color: colors.text,
  },
  backspaceText: {
    color: colors.negative,
  },
  disabledText: {
    color: colors.textMuted,
  },
});
