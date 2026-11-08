import React, { useState } from 'react';
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
  shadows,
  spacing,
} from '@/theme';
import { Button, Input, useToast } from '@/components';
import { useAuth } from '@/hooks/useAuth';
import {
  validateEmail,
  validatePassword,
  getSafeAuthErrorMessage,
  isNetworkOrOfflineError,
} from '@/lib/auth';
import { statusCodes } from '@/lib/googleAuth';

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password';

export interface AuthCardProps {
  initialMode?: AuthMode;
  onSuccess?: () => void;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  initialMode = 'sign-in',
  onSuccess,
}) => {
  const { signIn, signUp, signInWithGoogle, resetPassword, isConfigured } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const resetFormState = (newMode: AuthMode) => {
    setMode(newMode);
    setEmailError(null);
    setPasswordError(null);
    setGeneralError(null);
    setSuccessMessage(null);
  };

  const handleGoogleSignIn = async () => {
    setGeneralError(null);
    setSuccessMessage(null);
    setIsGoogleLoading(true);

    try {
      const result = await signInWithGoogle();
      if (result.error) {
        if (
          result.error.code === statusCodes.SIGN_IN_CANCELLED ||
          result.error.code === 'SIGN_IN_CANCELLED'
        ) {
          // User intentionally cancelled or dismissed the Google Sign-In prompt
          return;
        }
        setGeneralError(result.error.message);
        showToast({ message: result.error.message, variant: 'error' });
      } else {
        showToast({ message: 'Signed in with Google successfully!', variant: 'success' });
        onSuccess?.();
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during Google sign-in.';
      setGeneralError(message);
      showToast({ message, variant: 'error' });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async () => {
    setEmailError(null);
    setPasswordError(null);
    setGeneralError(null);
    setSuccessMessage(null);

    // Validate inputs
    const eError = validateEmail(email);
    if (eError) {
      setEmailError(eError);
      return;
    }

    if (mode !== 'forgot-password') {
      const pError = validatePassword(password);
      if (pError) {
        setPasswordError(pError);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (mode === 'sign-in') {
        const result = await signIn(email, password);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          const safeMsg = getSafeAuthErrorMessage('sign-in', result.error);
          setGeneralError(safeMsg);
          if (isNetwork) {
            showToast({ message: safeMsg, variant: 'error' });
          }
        } else {
          showToast({ message: 'Signed in successfully!', variant: 'success' });
          onSuccess?.();
        }
      } else if (mode === 'sign-up') {
        const result = await signUp(email, password);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          const safeMsg = getSafeAuthErrorMessage('sign-up', result.error);
          setGeneralError(safeMsg);
          if (isNetwork) {
            showToast({ message: safeMsg, variant: 'error' });
          }
        } else {
          if (result.data?.requiresEmailConfirmation) {
            setSuccessMessage(
              'Account created! Please check your email to confirm your account before signing in.'
            );
            showToast({
              message: 'Confirmation email sent. Please check your inbox.',
              variant: 'success',
            });
          } else {
            showToast({ message: 'Account created and signed in!', variant: 'success' });
            onSuccess?.();
          }
        }
      } else if (mode === 'forgot-password') {
        const result = await resetPassword(email);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          const safeMsg = getSafeAuthErrorMessage('forgot-password', result.error);
          setGeneralError(safeMsg);
          if (isNetwork) {
            showToast({ message: safeMsg, variant: 'error' });
          }
        } else {
          setSuccessMessage(
            'Password reset instructions have been sent to your email address.'
          );
          showToast({
            message: 'Password reset link sent to your email.',
            variant: 'success',
          });
        }
      }
    } catch (err) {
      const isNetwork = isNetworkOrOfflineError(err);
      const safeMsg = getSafeAuthErrorMessage(mode, err);
      setGeneralError(safeMsg);
      if (isNetwork) {
        showToast({ message: safeMsg, variant: 'error' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.cardContainer}>
      {/* Unconfigured environment banner if needed */}
      {!isConfigured && (
        <View style={styles.unconfiguredBanner}>
          <Text style={styles.unconfiguredTitle}>⚠️ SETUP REQUIRED</Text>
          <Text style={styles.unconfiguredBody}>
            Supabase keys are not set in your .env file. Copy .env.example to .env to enable authentication.
          </Text>
        </View>
      )}

      {/* Mode toggle tabs */}
      {mode !== 'forgot-password' ? (
        <View style={styles.tabBar} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'sign-in' }}
            accessibilityLabel="Switch to Sign In"
            onPress={() => resetFormState('sign-in')}
            style={[styles.tab, mode === 'sign-in' && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === 'sign-in' && styles.tabTextActive]}>
              Sign In
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'sign-up' }}
            accessibilityLabel="Switch to Sign Up"
            onPress={() => resetFormState('sign-up')}
            style={[styles.tab, mode === 'sign-up' && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === 'sign-up' && styles.tabTextActive]}>
              Create Account
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.forgotHeader}>
          <Text style={styles.forgotTitle}>Password Recovery</Text>
          <Text style={styles.forgotSubtitle}>
            Enter your email to receive password reset instructions.
          </Text>
        </View>
      )}

      {/* Visually distinct Google Sign-In button */}
      {mode !== 'forgot-password' && (
        <>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            loading={isGoogleLoading}
            disabled={isSubmitting || isGoogleLoading}
            onPress={handleGoogleSignIn}
            accessibilityLabel="Continue with Google"
            accessibilityHint="Sign in using your Google account"
          >
            <View style={styles.googleButtonContent}>
              <View style={styles.googleIconBadge}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
              <View style={styles.googleTagBadge}>
                <Text style={styles.googleTagText}>OAuth</Text>
              </View>
            </View>
          </Button>

          {/* Neobrutalist Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <View style={styles.dividerBadge}>
              <Text style={styles.dividerText}>OR WITH EMAIL</Text>
            </View>
            <View style={styles.dividerLine} />
          </View>
        </>
      )}

      {/* General error message box */}
      {generalError && (
        <View
          style={styles.errorBox}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.errorBoxTitle}>Authentication Error</Text>
          <Text style={styles.errorBoxMessage}>{generalError}</Text>
        </View>
      )}

      {/* Success message box */}
      {successMessage && (
        <View
          style={styles.successBox}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.successBoxTitle}>Success</Text>
          <Text style={styles.successBoxMessage}>{successMessage}</Text>
        </View>
      )}

      {/* Form Inputs */}
      <View style={styles.formContainer}>
        <Input
          label="Email Address"
          placeholder="name@example.com"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (emailError) setEmailError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          error={emailError ?? undefined}
          editable={!isSubmitting && !isGoogleLoading}
        />

        {mode !== 'forgot-password' && (
          <Input
            label="Password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) setPasswordError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'sign-in' ? 'password' : 'new-password'}
            error={passwordError ?? undefined}
            editable={!isSubmitting && !isGoogleLoading}
          />
        )}

        {/* Forgot password link in sign-in mode */}
        {mode === 'sign-in' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Forgot Password"
            onPress={() => resetFormState('forgot-password')}
            style={styles.forgotLink}
            disabled={isSubmitting || isGoogleLoading}
          >
            <Text style={styles.forgotLinkText}>Forgot your password?</Text>
          </Pressable>
        )}

        {/* Action Button */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting || isGoogleLoading}
          onPress={handleSubmit}
          title={
            mode === 'sign-in'
              ? 'Sign In'
              : mode === 'sign-up'
              ? 'Create Account'
              : 'Send Reset Instructions'
          }
        />

        {/* Back to Sign In button for forgot-password mode */}
        {mode === 'forgot-password' && (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            disabled={isSubmitting}
            onPress={() => resetFormState('sign-in')}
            title="← Back to Sign In"
            style={styles.backButton}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    ...shadows.default,
  },
  unconfiguredBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  unconfiguredTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: '#92400E',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  unconfiguredBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: '#78350F',
    lineHeight: lineHeights.xs,
  },
  tabBar: {
    flexDirection: 'row',
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tabActive: {
    backgroundColor: colors.accent,
    borderRightWidth: borderWidths.regular,
    borderLeftWidth: borderWidths.regular,
    borderColor: colors.border,
  },
  tabText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
  tabTextActive: {
    fontFamily: fonts.bold,
    color: colors.black,
  },
  forgotHeader: {
    marginBottom: spacing.md,
  },
  forgotTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  forgotSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: lineHeights.sm,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  googleIconBadge: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.black,
  },
  googleButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  googleTagBadge: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  googleTagText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
  },
  dividerBadge: {
    backgroundColor: colors.background,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  dividerText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.text,
    letterSpacing: 0.5,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderWidth: borderWidths.regular,
    borderColor: colors.negative,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBoxTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.negative,
    marginBottom: spacing.xs / 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorBoxMessage: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: '#991B1B',
    lineHeight: lineHeights.xs,
  },
  successBox: {
    backgroundColor: '#DCFCE7',
    borderWidth: borderWidths.regular,
    borderColor: colors.positive,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  successBoxTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.positive,
    marginBottom: spacing.xs / 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  successBoxMessage: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: '#166534',
    lineHeight: lineHeights.xs,
  },
  formContainer: {
    gap: spacing.xs,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  forgotLinkText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  backButton: {
    marginTop: spacing.sm,
  },
});
