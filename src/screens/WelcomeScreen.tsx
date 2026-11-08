import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  shadowOffsets,
  spacing,
} from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeftIcon,
  Button,
  EyeIcon,
  EyeOffIcon,
  GoogleIcon,
  Input,
  MailIcon,
  Penny,
  SquiggleUnderline,
  useToast,
} from '@/components';
import { useAuth } from '@/hooks/useAuth';
import {
  getSafeAuthErrorMessage,
  isNetworkOrOfflineError,
  validateEmail,
  validatePassword,
} from '@/lib/auth';
import { statusCodes } from '@/lib/googleAuth';

export type WelcomeViewMode = 'hero' | 'email';
export type EmailAuthMode = 'sign-in' | 'sign-up' | 'forgot-password';

export interface WelcomeScreenProps {
  onNavigateToDemo?: () => void;
}

const PLACEHOLDER_COLOR = '#767676'; // Light gray with 4.6:1 contrast against white (#FFFFFF)

export const WelcomeScreen: React.FC<WelcomeScreenProps> = () => {
  const insets = useSafeAreaInsets();
  const { signIn, signUp, signInWithGoogle, resetPassword, syncPaused } = useAuth();
  const { showToast } = useToast();

  // Screen view state: 'hero' (landing) or 'email' (switched in place)
  const [viewMode, setViewMode] = useState<WelcomeViewMode>('hero');
  const [emailMode, setEmailMode] = useState<EmailAuthMode>('sign-in');

  // Form input state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Status & error state
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [networkOfflineError, setNetworkOfflineError] = useState(false);

  // Refs for keyboard focus navigation
  const passwordInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Detect offline status via syncPaused or navigator
  const isOffline =
    syncPaused === 'offline' ||
    networkOfflineError ||
    (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine);

  const clearMessages = () => {
    setGeneralError(null);
    setSuccessMessage(null);
  };

  const handleSwitchToEmail = () => {
    clearMessages();
    setViewMode('email');
    setEmailMode('sign-in');
  };

  const handleBackToHero = () => {
    clearMessages();
    setPassword('');
    setShowPassword(false);
    setViewMode('hero');
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading || isSubmitting) return;

    clearMessages();
    setIsGoogleLoading(true);

    try {
      const result = await signInWithGoogle();
      if (result.error) {
        if (
          result.error.code === statusCodes.SIGN_IN_CANCELLED ||
          result.error.code === 'SIGN_IN_CANCELLED'
        ) {
          return;
        }

        const isNetwork = isNetworkOrOfflineError(result.error);
        if (isNetwork) {
          setNetworkOfflineError(true);
          showToast({
            message: 'Unable to connect to the authentication server. Please check your internet connection.',
            variant: 'error',
          });
        }

        const safeMessage = getSafeAuthErrorMessage('sign-in', result.error);
        setGeneralError(safeMessage);
      }
    } catch (err) {
      const isNetwork = isNetworkOrOfflineError(err);
      if (isNetwork) {
        setNetworkOfflineError(true);
        showToast({
          message: 'Unable to connect to the authentication server. Please check your internet connection.',
          variant: 'error',
        });
      }
      const safeMessage = getSafeAuthErrorMessage('sign-in', err);
      setGeneralError(safeMessage);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting || isGoogleLoading) return;

    clearMessages();

    // 1. Email format validation before submit
    const emailErr = validateEmail(email);
    if (emailErr) {
      setGeneralError(emailErr);
      return;
    }

    // 2. Password validation before submit
    if (emailMode !== 'forgot-password') {
      if (emailMode === 'sign-in') {
        if (!password) {
          setGeneralError('Wrong email or password. Please try again.');
          return;
        }
      } else {
        const passwordErr = validatePassword(password);
        if (passwordErr) {
          setGeneralError(passwordErr);
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      if (emailMode === 'sign-in') {
        const result = await signIn(email, password);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          if (isNetwork) {
            setNetworkOfflineError(true);
            showToast({
              message: 'Unable to connect to the authentication server. Please check your internet connection.',
              variant: 'error',
            });
            setGeneralError('Unable to connect to the authentication server. Please check your internet connection.');
          } else {
            // Strict rule: ONE generic message for failed sign-in
            setGeneralError('Wrong email or password. Please try again.');
          }
        }
      } else if (emailMode === 'sign-up') {
        const result = await signUp(email, password);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          if (isNetwork) {
            setNetworkOfflineError(true);
            showToast({
              message: 'Unable to connect to the authentication server. Please check your internet connection.',
              variant: 'error',
            });
          }
          const safeMsg = getSafeAuthErrorMessage('sign-up', result.error);
          setGeneralError(safeMsg);
        } else if (result.data?.requiresEmailConfirmation) {
          setSuccessMessage(
            'Account created! Please check your email to confirm your account before signing in.'
          );
        }
      } else if (emailMode === 'forgot-password') {
        const result = await resetPassword(email);
        if (result.error) {
          const isNetwork = isNetworkOrOfflineError(result.error);
          if (isNetwork) {
            setNetworkOfflineError(true);
            showToast({
              message: 'Unable to connect to the authentication server. Please check your internet connection.',
              variant: 'error',
            });
          }
          const safeMsg = getSafeAuthErrorMessage('forgot-password', result.error);
          setGeneralError(safeMsg);
        } else {
          setSuccessMessage('Password reset link sent to your email.');
        }
      }
    } catch (err) {
      const isNetwork = isNetworkOrOfflineError(err);
      if (isNetwork) {
        setNetworkOfflineError(true);
        showToast({
          message: 'Unable to connect to the authentication server. Please check your internet connection.',
          variant: 'error',
        });
      }
      const safeMsg = getSafeAuthErrorMessage(emailMode, err);
      setGeneralError(safeMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardContainer}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {viewMode === 'hero' ? (
          /* ================================================================ */
          /* HERO / LANDING MODE                                              */
          /* ================================================================ */
          <View style={styles.contentWrapper}>
            {/* 1. Header: Big Bold Title, Squiggle Underline, Tagline */}
            <View style={styles.heroHeader}>
              <Text
                style={styles.title}
                accessibilityRole="header"
                accessibilityLabel="Where Did It Go?"
              >
                Where Did It Go?
              </Text>
              <SquiggleUnderline
                width={150}
                height={14}
                color={colors.accent}
                strokeWidth={3.5}
                style={styles.squiggle}
              />
              <Text style={styles.tagline}>Now you know.</Text>
            </View>

            {/* 2. Hero Card: Penny in Wallet + Yellow "Offline-first" Sticker */}
            <View style={styles.heroCardContainer}>
              {/* Hard offset shadow */}
              <View pointerEvents="none" style={styles.heroCardShadow} />

              {/* Card Face */}
              <View style={styles.heroCardFace}>
                <Penny width={220} height={165} />
              </View>

              {/* Yellow Sticker overlapping card top corner, rotated -3 deg */}
              <View
                style={styles.stickerBadge}
                accessible={false}
                aria-hidden={true}
              >
                <Text style={styles.stickerText}>Offline-first</Text>
              </View>
            </View>

            {/* 3. Three Small Chips (Decorative, Slight Tilt +-2 to 3 deg) */}
            <View
              style={styles.chipsRow}
              accessible={false}
              aria-hidden={true}
            >
              <View style={[styles.decorativeChipWrapper, styles.chipTiltLeft]}>
                <View style={styles.chipShadow} />
                <View style={[styles.chipFace, styles.chipWhite]}>
                  <Text style={styles.chipText}>Works offline</Text>
                </View>
              </View>

              <View style={[styles.decorativeChipWrapper, styles.chipTiltRight]}>
                <View style={styles.chipShadow} />
                <View style={[styles.chipFace, styles.chipYellow]}>
                  <Text style={styles.chipText}>Monthly goals</Text>
                </View>
              </View>

              <View style={[styles.decorativeChipWrapper, styles.chipTiltLeftMild]}>
                <View style={styles.chipShadow} />
                <View style={[styles.chipFace, styles.chipWhite]}>
                  <Text style={styles.chipText}>No bank login</Text>
                </View>
              </View>
            </View>

            {/* Offline notification banner if device is offline */}
            {isOffline && (
              <View
                style={styles.offlineBox}
                accessibilityRole="status"
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.offlineBoxText}>First sign-in needs internet.</Text>
              </View>
            )}

            {/* General error box if any auth/network problem occurred */}
            {generalError && (
              <View
                style={styles.errorBox}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.errorBoxText}>{generalError}</Text>
              </View>
            )}

            {/* 4. Action Buttons (STRAIGHT, Never Rotated, Press-down effect) */}
            <View style={styles.buttonStack}>
              {/* White "Continue with Google" button */}
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                loading={isGoogleLoading}
                disabled={isSubmitting || isGoogleLoading || isOffline}
                onPress={handleGoogleSignIn}
                accessibilityLabel="Continue with Google"
                accessibilityHint="Sign in using your Google account"
              >
                <View style={styles.buttonContentRow}>
                  <GoogleIcon size={20} />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </View>
              </Button>

              {/* Yellow "Continue with email" button */}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={isSubmitting || isGoogleLoading || isOffline}
                onPress={handleSwitchToEmail}
                accessibilityLabel="Continue with email"
                accessibilityHint="Sign in or register with email"
              >
                <View style={styles.buttonContentRow}>
                  <MailIcon size={20} color={colors.black} />
                  <Text style={styles.emailButtonText}>Continue with email</Text>
                </View>
              </Button>
            </View>

            {/* 5. Footer Line (Exact Truthful Copy) */}
            <View style={styles.footerContainer}>
              <View style={styles.footerDivider} />
              <Text style={styles.footerText}>
                Works offline. Syncs when you&apos;re online. Your entries are saved on your phone and synced to your private account.
              </Text>
            </View>
          </View>
        ) : (
          /* ================================================================ */
          /* EMAIL MODE (Switched in Place, Follows welcome-email-form.png)    */
          /* ================================================================ */
          <View style={styles.contentWrapper}>
            {/* Top Header Row: Title & Tagline on Left, Back Arrow on Right */}
            <View style={styles.emailHeaderRow}>
              <View style={styles.emailHeaderTitles}>
                <Text
                  style={styles.emailHeaderTitle}
                  accessibilityRole="header"
                  accessibilityLabel="Where Did It Go?"
                >
                  Where Did It Go?
                </Text>
                <Text style={styles.emailHeaderTagline}>Now you know.</Text>
              </View>

              {/* Plain back arrow button in the corner (replacing yellow coin) */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to welcome screen"
                accessibilityHint="Return to the main welcome screen"
                onPress={handleBackToHero}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.backButtonPressed,
                ]}
              >
                <ArrowLeftIcon size={20} color={colors.black} strokeWidth={2.5} />
              </Pressable>
            </View>

            {/* Segmented Toggle: SIGN IN / CREATE ACCOUNT */}
            {emailMode !== 'forgot-password' ? (
              <View style={styles.tabBar} accessibilityRole="tablist">
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: emailMode === 'sign-in' }}
                  accessibilityLabel="Switch to Sign In"
                  onPress={() => {
                    clearMessages();
                    setEmailMode('sign-in');
                  }}
                  style={[
                    styles.tab,
                    emailMode === 'sign-in' && styles.tabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      emailMode === 'sign-in' && styles.tabTextActive,
                    ]}
                  >
                    SIGN IN
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: emailMode === 'sign-up' }}
                  accessibilityLabel="Switch to Create Account"
                  onPress={() => {
                    clearMessages();
                    setEmailMode('sign-up');
                  }}
                  style={[
                    styles.tab,
                    emailMode === 'sign-up' && styles.tabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      emailMode === 'sign-up' && styles.tabTextActive,
                    ]}
                  >
                    CREATE ACCOUNT
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

            {/* Form Card */}
            <View style={styles.formCard}>
              {/* Hard offset shadow */}
              <View pointerEvents="none" style={styles.formCardShadow} />

              <View style={styles.formCardFace}>
                {/* Offline banner */}
                {isOffline && (
                  <View
                    style={styles.offlineBox}
                    accessibilityRole="status"
                    accessibilityLiveRegion="polite"
                  >
                    <Text style={styles.offlineBoxText}>
                      First sign-in needs internet.
                    </Text>
                  </View>
                )}

                {/* Red bordered error box */}
                {generalError && (
                  <View
                    style={styles.errorBox}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                  >
                    <Text style={styles.errorBoxText}>{generalError}</Text>
                  </View>
                )}

                {/* Green bordered success box */}
                {successMessage && (
                  <View
                    style={styles.successBox}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                  >
                    <Text style={styles.successBoxText}>{successMessage}</Text>
                  </View>
                )}

                {/* Email Address Input */}
                <Input
                  label="EMAIL ADDRESS"
                  placeholder="name@example.com"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (generalError) clearMessages();
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType={emailMode === 'forgot-password' ? 'go' : 'next'}
                  onSubmitEditing={() => {
                    if (emailMode === 'forgot-password') {
                      handleSubmit();
                    } else {
                      passwordInputRef.current?.focus();
                    }
                  }}
                  editable={!isSubmitting && !isGoogleLoading}
                  accessibilityLabel="Email Address"
                />

                {/* Password Input (Sign in & Create Account modes) */}
                {emailMode !== 'forgot-password' && (
                  <Input
                    ref={passwordInputRef}
                    label="PASSWORD"
                    labelRight={
                      emailMode === 'sign-in' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Forgot password?"
                          onPress={() => {
                            clearMessages();
                            setEmailMode('forgot-password');
                          }}
                          disabled={isSubmitting || isGoogleLoading}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.forgotLinkText}>FORGOT PASSWORD?</Text>
                        </Pressable>
                      ) : null
                    }
                    placeholder="••••••••••••"
                    placeholderTextColor={PLACEHOLDER_COLOR}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (generalError) clearMessages();
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={emailMode === 'sign-in' ? 'password' : 'new-password'}
                    textContentType={emailMode === 'sign-in' ? 'password' : 'newPassword'}
                    returnKeyType={emailMode === 'sign-in' ? 'go' : 'done'}
                    onSubmitEditing={handleSubmit}
                    editable={!isSubmitting && !isGoogleLoading}
                    accessibilityLabel="Password"
                    rightAccessory={
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        onPress={() => setShowPassword((prev) => !prev)}
                        disabled={isSubmitting || isGoogleLoading}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {showPassword ? (
                          <EyeOffIcon size={20} color={colors.textSecondary} />
                        ) : (
                          <EyeIcon size={20} color={colors.textSecondary} />
                        )}
                      </Pressable>
                    }
                  />
                )}

                {/* Primary Action Button */}
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={isSubmitting}
                  disabled={isSubmitting || isGoogleLoading || isOffline}
                  onPress={handleSubmit}
                  accessibilityLabel={
                    emailMode === 'sign-in'
                      ? 'Sign In'
                      : emailMode === 'sign-up'
                      ? 'Create Account'
                      : 'Send Reset Link'
                  }
                  style={styles.primaryActionButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {emailMode === 'sign-in'
                      ? 'SIGN IN →'
                      : emailMode === 'sign-up'
                      ? 'CREATE ACCOUNT →'
                      : 'Send Reset Link'}
                  </Text>
                </Button>

                {/* Back to sign in link for password recovery */}
                {emailMode === 'forgot-password' && (
                  <Button
                    variant="secondary"
                    size="md"
                    fullWidth
                    disabled={isSubmitting}
                    onPress={() => {
                      clearMessages();
                      setEmailMode('sign-in');
                    }}
                    style={styles.backToSignInButton}
                    accessibilityLabel="Back to Sign In"
                  >
                    <Text style={styles.backToSignInText}>← Back to Sign In</Text>
                  </Button>
                )}

                {/* Divider: "OR CONTINUE WITH" */}
                {emailMode !== 'forgot-password' && (
                  <>
                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    {/* Google Sign In Button */}
                    <Button
                      variant="secondary"
                      size="lg"
                      fullWidth
                      loading={isGoogleLoading}
                      disabled={isSubmitting || isGoogleLoading || isOffline}
                      onPress={handleGoogleSignIn}
                      accessibilityLabel="Continue with Google"
                      accessibilityHint="Sign in using your Google account"
                    >
                      <View style={styles.buttonContentRow}>
                        <GoogleIcon size={20} />
                        <Text style={styles.googleButtonText}>Continue with Google</Text>
                      </View>
                    </Button>
                  </>
                )}
              </View>
            </View>

            {/* 5. Footer Line (Exact Truthful Copy) */}
            <View style={styles.footerContainer}>
              <View style={styles.footerDivider} />
              <Text style={styles.footerText}>
                Works offline. Syncs when you&apos;re online. Your entries are saved on your phone and synced to your private account.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  contentWrapper: {
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },

  /* Hero Section */
  heroHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['3xl'],
    lineHeight: lineHeights['3xl'],
    color: colors.black,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  squiggle: {
    marginTop: spacing.xs / 2,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  /* Hero Card */
  heroCardContainer: {
    position: 'relative',
    height: 200,
    marginRight: shadowOffsets.default.width,
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  heroCardShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.md,
  },
  heroCardFace: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stickerBadge: {
    position: 'absolute',
    top: -14,
    alignSelf: 'center',
    backgroundColor: colors.accent,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    transform: [{ rotate: '-3deg' }],
    zIndex: 10,
    ...shadows.sm,
  },
  stickerText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.black,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* Chips Row */
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  decorativeChipWrapper: {
    position: 'relative',
    marginRight: 2,
    marginBottom: 2,
  },
  chipShadow: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: -2,
    bottom: -2,
    backgroundColor: colors.border,
    borderRadius: radii.full,
  },
  chipFace: {
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWhite: {
    backgroundColor: colors.white,
  },
  chipYellow: {
    backgroundColor: colors.accent,
  },
  chipTiltLeft: {
    transform: [{ rotate: '-2.5deg' }],
  },
  chipTiltRight: {
    transform: [{ rotate: '2.5deg' }],
  },
  chipTiltLeftMild: {
    transform: [{ rotate: '-2deg' }],
  },
  chipText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.black,
  },

  /* Buttons */
  buttonStack: {
    gap: spacing.md,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  googleButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.black,
  },
  emailButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.black,
  },

  /* Footer */
  footerContainer: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  footerDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: spacing.md,
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  /* Email Mode Header */
  emailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  emailHeaderTitles: {
    flex: 1,
  },
  emailHeaderTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.black,
    letterSpacing: -0.5,
  },
  emailHeaderTagline: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
  },
  backButton: {
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  backButtonPressed: {
    transform: [{ translateX: 1 }, { translateY: 1 }],
  },

  /* Segmented Toggle */
  tabBar: {
    flexDirection: 'row',
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    marginRight: shadowOffsets.sm.width,
    ...shadows.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: colors.black,
  },

  /* Forgot Header */
  forgotHeader: {
    marginBottom: spacing.md,
  },
  forgotTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    color: colors.black,
  },
  forgotSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
  },

  /* Form Card */
  formCard: {
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: spacing.md,
  },
  formCardShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.md,
  },
  formCardFace: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },

  /* Error and Alert Boxes */
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderWidth: borderWidths.thick,
    borderColor: colors.negative,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBoxText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: '#991B1B',
  },
  offlineBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: borderWidths.thick,
    borderColor: '#D97706',
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  offlineBoxText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: '#92400E',
    textAlign: 'center',
  },
  successBox: {
    backgroundColor: '#DCFCE7',
    borderWidth: borderWidths.thick,
    borderColor: colors.positive,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  successBoxText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: '#166534',
  },

  /* Forgot Password Link */
  forgotLinkText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },

  /* Primary Action Button */
  primaryActionButton: {
    marginTop: spacing.xs,
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.black,
  },
  backToSignInButton: {
    marginTop: spacing.sm,
  },
  backToSignInText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    color: colors.black,
  },

  /* Divider */
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
  dividerText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
});

export default WelcomeScreen;
