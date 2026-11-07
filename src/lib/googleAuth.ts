import type { SignInResponse } from '@react-native-google-signin/google-signin';
import { supabase, isSupabaseConfigured } from './supabase';
import { AuthResult, SignInSuccessData } from './auth';

/**
 * =============================================================================
 * Google Authentication Module for Supabase
 * =============================================================================
 *
 * NOTE ON EXPO GO COMPATIBILITY:
 * Native Google Sign-In (@react-native-google-signin/google-signin) contains
 * custom native iOS and Android code and CANNOT run inside the standard Expo Go
 * application.
 *
 * To run and test Google Sign-In, you MUST use an Expo Development Build:
 *   - Android: `npx expo run:android`
 *   - iOS:     `npx expo run:ios`
 *   - Cloud:   `eas build --profile development`
 *
 * In Expo Go, this module safely falls back and returns a DEV_BUILD_REQUIRED
 * error result without crashing the module loader or the application.
 * =============================================================================
 */

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
} as const;

let cachedModule: GoogleSigninModule | null = null;
let moduleCheckDone = false;

/**
 * Lazily and safely attempts to load the native @react-native-google-signin module.
 * In environments where the native binary does not register 'RNGoogleSignin'
 * (such as Expo Go), the require fails gracefully and returns null.
 */
function getGoogleSignin(): GoogleSigninModule | null {
  if (moduleCheckDone) {
    return cachedModule;
  }
  moduleCheckDone = true;
  try {
    // Dynamic require wrapped in try/catch to prevent TurboModuleRegistry crash on load
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('@react-native-google-signin/google-signin');
    return cachedModule;
  } catch {
    cachedModule = null;
    return null;
  }
}

function isErrorWithCode(error: unknown): error is { code: string | number } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isCancelledError(error: unknown, nativeModule: GoogleSigninModule | null): boolean {
  if (!isErrorWithCode(error)) {
    return false;
  }
  const code = String(error.code);
  const nativeCancelled = nativeModule?.statusCodes?.SIGN_IN_CANCELLED;
  return (
    code === statusCodes.SIGN_IN_CANCELLED ||
    code === 'SIGN_IN_CANCELLED' ||
    code === '12501' ||
    code === '-5' ||
    (nativeCancelled != null && code === String(nativeCancelled))
  );
}

function isCancelled(response: SignInResponse, nativeModule: GoogleSigninModule | null): boolean {
  if (nativeModule?.isCancelledResponse) {
    try {
      return nativeModule.isCancelledResponse(response);
    } catch {
      // Fallback below
    }
  }
  return (response as { type?: string })?.type === 'cancelled';
}

function isSuccess(response: SignInResponse, nativeModule: GoogleSigninModule | null): boolean {
  if (nativeModule?.isSuccessResponse) {
    try {
      return nativeModule.isSuccessResponse(response);
    } catch {
      // Fallback below
    }
  }
  return (response as { type?: string })?.type === 'success';
}

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const isGoogleAuthAvailable = Boolean(webClientId);

let isConfigured = false;

/**
 * Configures the GoogleSignin native module with the web client ID.
 * Returns true if configuration was successfully performed.
 */
export function configureGoogleSignIn(): boolean {
  if (isConfigured) {
    return true;
  }
  if (!webClientId) {
    return false;
  }
  const googleSigninModule = getGoogleSignin();
  if (!googleSigninModule?.GoogleSignin) {
    return false;
  }
  try {
    googleSigninModule.GoogleSignin.configure({
      webClientId,
    });
    isConfigured = true;
    return true;
  } catch {
    // If native module is unavailable (e.g. running in Expo Go), fail gracefully
    return false;
  }
}

// Attempt initial configuration if the web client ID environment variable is present
if (webClientId) {
  configureGoogleSignIn();
}

/**
 * Initiates the native Google Sign-In flow, retrieves the OIDC ID token,
 * and authenticates with Supabase using `signInWithIdToken`.
 *
 * Handles:
 * - User cancellation (without throwing or crashing)
 * - Missing Google Play Services on Android
 * - Missing or null ID token
 * - Supabase token exchange failures
 *
 * SECURITY:
 * Never logs or exposes the raw ID token.
 *
 * NOTE: Does NOT work in Expo Go; requires an Expo development build.
 */
export async function signInWithGoogle(): Promise<AuthResult<SignInSuccessData>> {
  // 1. Verify Supabase configuration
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        message: 'Supabase credentials are not configured in your .env file.',
        code: 'SUPABASE_NOT_CONFIGURED',
      },
    };
  }

  // 2. Verify Google Web Client ID
  if (!webClientId) {
    return {
      data: null,
      error: {
        message:
          'Google Sign-In is not configured. Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
        code: 'CONFIG_MISSING',
      },
    };
  }

  // 3. Ensure native module is available
  const googleSigninModule = getGoogleSignin();
  if (!googleSigninModule?.GoogleSignin) {
    return {
      data: null,
      error: {
        message:
          'Google Sign-In requires an Expo Development Build and does not work in Expo Go.',
        code: 'DEV_BUILD_REQUIRED',
      },
    };
  }

  const { GoogleSignin } = googleSigninModule;

  // 4. Ensure native module configuration
  try {
    configureGoogleSignIn();
  } catch (configErr) {
    const rawMsg = configErr instanceof Error ? configErr.message : '';
    if (
      rawMsg.includes('RNGoogleSignin') ||
      rawMsg.includes('TurboModuleRegistry') ||
      rawMsg.includes('could not be found')
    ) {
      return {
        data: null,
        error: {
          message:
            'Google Sign-In requires an Expo Development Build and does not work in Expo Go.',
          code: 'DEV_BUILD_REQUIRED',
        },
      };
    }
    return {
      data: null,
      error: {
        message: 'Failed to configure Google Sign-In.',
        code: 'CONFIG_ERROR',
      },
    };
  }

  // 5. Verify Google Play Services (Android only)
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (playErr) {
    const playServicesNotAvailableCode =
      googleSigninModule.statusCodes?.PLAY_SERVICES_NOT_AVAILABLE ??
      statusCodes.PLAY_SERVICES_NOT_AVAILABLE;

    if (isErrorWithCode(playErr) && String(playErr.code) === String(playServicesNotAvailableCode)) {
      return {
        data: null,
        error: {
          message: 'Google Play Services is not available or outdated on this device.',
          code: String(playServicesNotAvailableCode),
        },
      };
    }
    const rawMsg = playErr instanceof Error ? playErr.message : '';
    if (
      rawMsg.includes('RNGoogleSignin') ||
      rawMsg.includes('TurboModuleRegistry') ||
      rawMsg.includes('could not be found')
    ) {
      return {
        data: null,
        error: {
          message:
            'Google Sign-In requires an Expo Development Build and does not work in Expo Go.',
          code: 'DEV_BUILD_REQUIRED',
        },
      };
    }
    return {
      data: null,
      error: {
        message:
          playErr instanceof Error
            ? playErr.message
            : 'Google Play Services verification failed.',
        code: isErrorWithCode(playErr) ? String(playErr.code) : 'PLAY_SERVICES_ERROR',
      },
    };
  }

  // 6. Open native Google Sign-In sheet
  let response: SignInResponse;
  try {
    response = await GoogleSignin.signIn();
  } catch (signInErr) {
    if (isCancelledError(signInErr, googleSigninModule)) {
      return {
        data: null,
        error: {
          message: 'Google sign-in was cancelled by the user.',
          code: statusCodes.SIGN_IN_CANCELLED,
        },
      };
    }

    const inProgressCode =
      googleSigninModule.statusCodes?.IN_PROGRESS ?? statusCodes.IN_PROGRESS;
    if (isErrorWithCode(signInErr) && String(signInErr.code) === String(inProgressCode)) {
      return {
        data: null,
        error: {
          message: 'Google sign-in is already in progress.',
          code: String(inProgressCode),
        },
      };
    }

    const playServicesCode =
      googleSigninModule.statusCodes?.PLAY_SERVICES_NOT_AVAILABLE ??
      statusCodes.PLAY_SERVICES_NOT_AVAILABLE;
    if (isErrorWithCode(signInErr) && String(signInErr.code) === String(playServicesCode)) {
      return {
        data: null,
        error: {
          message: 'Google Play Services is not available or outdated on this device.',
          code: String(playServicesCode),
        },
      };
    }

    const rawMsg = signInErr instanceof Error ? signInErr.message : '';
    if (
      rawMsg.includes('RNGoogleSignin') ||
      rawMsg.includes('TurboModuleRegistry') ||
      rawMsg.includes('could not be found')
    ) {
      return {
        data: null,
        error: {
          message:
            'Google Sign-In requires an Expo Development Build and does not work in Expo Go.',
          code: 'DEV_BUILD_REQUIRED',
        },
      };
    }

    return {
      data: null,
      error: {
        message:
          signInErr instanceof Error
            ? signInErr.message
            : 'An unexpected error occurred during Google sign-in.',
        code: isErrorWithCode(signInErr) ? String(signInErr.code) : 'SIGN_IN_FAILED',
      },
    };
  }

  // 7. Handle user cancellation response
  if (isCancelled(response, googleSigninModule)) {
    return {
      data: null,
      error: {
        message: 'Google sign-in was cancelled by the user.',
        code: statusCodes.SIGN_IN_CANCELLED,
      },
    };
  }

  // 8. Verify response type
  if (!isSuccess(response, googleSigninModule)) {
    return {
      data: null,
      error: {
        message: 'Unexpected response received from Google Sign-In.',
        code: 'UNEXPECTED_RESPONSE',
      },
    };
  }

  // 9. Retrieve ID token securely (Never log tokens)
  const idToken = response.data?.idToken;
  if (!idToken) {
    return {
      data: null,
      error: {
        message:
          'No ID token was returned by Google. Ensure EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID matches your Google Cloud Console OAuth Web Client ID.',
        code: 'MISSING_ID_TOKEN',
      },
    };
  }

  // 10. Authenticate with Supabase using signInWithIdToken
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) {
      return {
        data: null,
        error: {
          message:
            error.message ||
            'Supabase authentication failed with Google credentials.',
          code: error.code,
          status: error.status,
        },
      };
    }

    if (!data.user || !data.session) {
      return {
        data: null,
        error: {
          message:
            'Authentication succeeded but no active session was returned by Supabase.',
          code: 'NO_SESSION',
        },
      };
    }

    return {
      data: {
        user: data.user,
        session: data.session,
      },
      error: null,
    };
  } catch (exchangeErr) {
    const message =
      exchangeErr instanceof Error
        ? exchangeErr.message
        : 'An error occurred while authenticating with Supabase.';
    return {
      data: null,
      error: {
        message,
        code: 'SUPABASE_EXCHANGE_ERROR',
      },
    };
  }
}

/**
 * Signs out from both native Google Sign-In and Supabase.
 *
 * NOTE: Does NOT work in Expo Go; requires an Expo development build.
 */
export async function signOutGoogle(): Promise<AuthResult<null>> {
  // Sign out of Google native client if possible
  const googleSigninModule = getGoogleSignin();
  if (googleSigninModule?.GoogleSignin) {
    try {
      await googleSigninModule.GoogleSignin.signOut();
    } catch {
      // If user was not signed in with Google or native call fails, safely continue
    }
  }

  // Sign out of Supabase
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    return { data: null, error: null };
  } catch {
    try {
      await supabase.auth.signOut({ scope: 'local' });
      return { data: null, error: null };
    } catch (fallbackErr) {
      const message =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : 'Failed to sign out of Supabase.';
      return { data: null, error: { message } };
    }
  }
}
