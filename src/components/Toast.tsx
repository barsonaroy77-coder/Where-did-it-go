import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export type ToastVariant = 'default' | 'success' | 'error';
export type ToastPosition = 'top' | 'bottom';

export interface ToastAction {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
  duration?: number;
  position?: ToastPosition;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  messageStyle?: StyleProp<TextStyle>;
  actionStyle?: StyleProp<ViewStyle>;
  actionTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export interface ToastOptions {
  id?: string;
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
  duration?: number;
  position?: ToastPosition;
  onDismiss?: () => void;
}

export interface ToastContextValue {
  showToast: (options: ToastOptions | string) => void;
  hideToast: () => void;
}

const DEFAULT_DURATION_MS = 5000;
const ANIM_DURATION_MS = 200;

/**
 * Toast banner component with neobrutalist styling and optional action button.
 */
export const Toast: React.FC<ToastProps> = ({
  message,
  variant = 'default',
  action,
  duration = DEFAULT_DURATION_MS,
  position = 'bottom',
  onDismiss,
  style,
  contentStyle,
  messageStyle,
  actionStyle,
  actionTextStyle,
  testID,
}) => {
  const isDismissing = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialOffset = position === 'top' ? -24 : 24;
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(initialOffset);

  const handleDismiss = useCallback(() => {
    if (isDismissing.current) return;
    isDismissing.current = true;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const exitOffset = position === 'top' ? -24 : 24;
    opacity.value = withTiming(0, { duration: ANIM_DURATION_MS });
    translateY.value = withTiming(exitOffset, { duration: ANIM_DURATION_MS }, (finished) => {
      if (finished && onDismiss) {
        runOnJS(onDismiss)();
      }
    });
  }, [onDismiss, opacity, position, translateY]);

  // Enter animation on mount
  useEffect(() => {
    opacity.value = withTiming(1, { duration: ANIM_DURATION_MS });
    translateY.value = withSpring(0, { damping: 16, stiffness: 140 });
  }, [opacity, translateY]);

  // Auto-dismiss timer (default 5000 ms)
  useEffect(() => {
    if (duration <= 0 || !isFinite(duration)) return;

    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [duration, handleDismiss]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handleActionPress = () => {
    action?.onPress();
    handleDismiss();
  };

  // Variant styling
  const variantSurfaceStyle = {
    default: styles.surfaceDefault,
    success: styles.surfaceSuccess,
    error: styles.surfaceError,
  }[variant];

  const variantTextColor = {
    default: colors.text,
    success: colors.white,
    error: colors.white,
  }[variant];

  const variantActionStyle = {
    default: styles.actionButtonDefault,
    success: styles.actionButtonSuccess,
    error: styles.actionButtonError,
  }[variant];

  const variantActionTextColor = {
    default: colors.text,
    success: colors.text,
    error: colors.text,
  }[variant];

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.wrapper, animatedStyle, style]}
    >
      {/* Hard offset shadow underlay */}
      <View pointerEvents="none" style={styles.shadow} />

      {/* Toast banner face */}
      <View
        style={[
          styles.surface,
          variantSurfaceStyle,
          contentStyle,
        ]}
      >
        <Text
          style={[
            styles.message,
            { color: variantTextColor },
            messageStyle,
          ]}
        >
          {message}
        </Text>

        <View style={styles.actionsContainer}>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              onPress={handleActionPress}
              style={({ pressed }) => [
                styles.actionButton,
                variantActionStyle,
                pressed && styles.actionButtonPressed,
                actionStyle,
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: variantActionTextColor },
                  actionTextStyle,
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ) : null}

          {/* Dismiss button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
          >
            <Text
              style={[
                styles.closeText,
                { color: variantTextColor },
              ]}
            >
              ✕
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Provider wrapping the application to manage toast banners imperatively.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toast, setToast] = useState<ToastOptions | null>(null);

  const showToast = useCallback((options: ToastOptions | string) => {
    if (typeof options === 'string') {
      setToast({
        id: `toast_${Date.now()}_${Math.random()}`,
        message: options,
        variant: 'default',
        duration: DEFAULT_DURATION_MS,
      });
    } else {
      setToast({
        id: options.id ?? `toast_${Date.now()}_${Math.random()}`,
        duration: options.duration ?? DEFAULT_DURATION_MS,
        ...options,
      });
    }
  }, []);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  const insets = useSafeAreaInsets();

  const position = toast?.position ?? 'bottom';
  const positionStyle: ViewStyle =
    position === 'top'
      ? { top: (insets?.top ?? 0) + spacing.md }
      : { bottom: (insets?.bottom ?? 0) + spacing.md };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={[styles.providerOverlay, positionStyle]}
        >
          <Toast
            key={toast.id}
            message={toast.message}
            variant={toast.variant}
            action={toast.action}
            duration={toast.duration}
            position={position}
            onDismiss={() => {
              toast.onDismiss?.();
              hideToast();
            }}
          />
        </View>
      ) : null}
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast capabilities from any component or screen.
 */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  providerOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    alignItems: 'center',
  },
  wrapper: {
    position: 'relative',
    width: '100%',
    maxWidth: 500,
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
    paddingVertical: spacing[3],
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  surfaceDefault: {
    backgroundColor: colors.surface,
  },
  surfaceSuccess: {
    backgroundColor: colors.positive,
  },
  surfaceError: {
    backgroundColor: colors.negative,
  },
  message: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDefault: {
    backgroundColor: colors.accent,
  },
  actionButtonSuccess: {
    backgroundColor: colors.white,
  },
  actionButtonError: {
    backgroundColor: colors.white,
  },
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  closeButton: {
    padding: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  closeText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
});

export default Toast;
