import React, { forwardRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  TextInputProps,
} from 'react-native';
import {
  colors,
  borderWidths,
  radii,
  fonts,
  fontSizes,
  lineHeights,
  spacing,
} from '@/theme';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  hintStyle?: StyleProp<TextStyle>;
  labelRight?: React.ReactNode;
  rightAccessory?: React.ReactNode;
}

export const Input = forwardRef<React.ComponentRef<typeof TextInput>, InputProps>(
  (
    {
      label,
      error,
      hint,
      containerStyle,
      inputStyle,
      labelStyle,
      errorStyle,
      hintStyle,
      labelRight,
      rightAccessory,
      accessibilityLabel,
      onFocus,
      onBlur,
      editable = true,
      ...textInputProps
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus: TextInputProps['onFocus'] = (e) => {
      setIsFocused(true);
      onFocus?.(e);
    };

    const handleBlur: TextInputProps['onBlur'] = (e) => {
      setIsFocused(false);
      onBlur?.(e);
    };

    const hasError = Boolean(error);
    const resolvedAccessibilityLabel = accessibilityLabel ?? label;

    return (
      <View style={[styles.container, containerStyle]}>
        {label || labelRight ? (
          <View style={styles.labelRow}>
            {label ? (
              <Text style={[styles.label, labelStyle]}>
                {label}
              </Text>
            ) : <View />}
            {labelRight}
          </View>
        ) : null}

        {rightAccessory ? (
          <View
            style={[
              styles.inputWrapper,
              hasError ? styles.inputError : isFocused ? styles.inputFocused : null,
              !editable && styles.inputDisabled,
            ]}
          >
            <TextInput
              ref={ref}
              editable={editable}
              accessibilityLabel={resolvedAccessibilityLabel}
              accessibilityState={{
                disabled: !editable,
              }}
              aria-invalid={hasError}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.text}
              onFocus={handleFocus}
              onBlur={handleBlur}
              style={[
                styles.inputWithAccessory,
                !editable && styles.inputDisabled,
                inputStyle,
              ]}
              {...textInputProps}
            />
            <View style={styles.rightAccessory}>{rightAccessory}</View>
          </View>
        ) : (
          <TextInput
            ref={ref}
            editable={editable}
            accessibilityLabel={resolvedAccessibilityLabel}
            accessibilityState={{
              disabled: !editable,
            }}
            aria-invalid={hasError}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.text}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={[
              styles.input,
              hasError ? styles.inputError : isFocused ? styles.inputFocused : null,
              !editable && styles.inputDisabled,
              inputStyle,
            ]}
            {...textInputProps}
          />
        )}

        {hasError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, errorStyle]}
          >
            {error}
          </Text>
        ) : hint ? (
          <Text style={[styles.hintText, hintStyle]}>
            {hint}
          </Text>
        ) : null}
      </View>
    );
  }
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.text,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    fontFamily: fonts.medium,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing.md,
  },
  inputWrapper: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWithAccessory: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing.md,
  },
  rightAccessory: {
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputFocused: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.negative,
  },
  inputDisabled: {
    backgroundColor: colors.background,
    color: colors.textMuted,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.negative,
    marginTop: spacing.xs,
  },
  hintText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});

export default Input;
