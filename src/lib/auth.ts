import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

export interface AuthErrorDetails {
  message: string;
  code?: string;
  status?: number;
}

export interface AuthResult<T = unknown> {
  data: T | null;
  error: AuthErrorDetails | null;
}

export interface SignInSuccessData {
  user: User;
  session: Session;
}

export interface SignUpSuccessData {
  user: User | null;
  session: Session | null;
  requiresEmailConfirmation: boolean;
}

/**
 * Validates email format strictly using regex.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return 'Email address is required.';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

/**
 * Validates password length and format.
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }
  if (password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

/**
 * Formats Supabase auth errors into clean, user-friendly messages.
 */
function formatAuthError(error: unknown): AuthErrorDetails {
  if (!error || typeof error !== 'object') {
    return { message: 'An unexpected authentication error occurred.' };
  }

  const err = error as { message?: string; code?: string; status?: number };
  const rawMessage = (err.message || '').toLowerCase();

  if (rawMessage.includes('invalid login credentials') || rawMessage.includes('invalid credentials')) {
    return {
      message: 'Invalid email or password. Please check your credentials and try again.',
      code: err.code,
      status: err.status,
    };
  }

  if (rawMessage.includes('email not confirmed')) {
    return {
      message: 'Please confirm your email address before signing in. Check your inbox for the confirmation link.',
      code: err.code,
      status: err.status,
    };
  }

  if (rawMessage.includes('user already registered') || rawMessage.includes('already exists')) {
    return {
      message: 'An account with this email already exists. Try signing in instead.',
      code: err.code,
      status: err.status,
    };
  }

  if (rawMessage.includes('password should be at least')) {
    return {
      message: 'Password must be at least 6 characters.',
      code: err.code,
      status: err.status,
    };
  }

  if (rawMessage.includes('network') || rawMessage.includes('fetch') || rawMessage.includes('failed to fetch')) {
    return {
      message: 'Unable to connect to the authentication server. Please check your internet connection.',
      code: err.code,
      status: err.status,
    };
  }

  return {
    message: err.message || 'Authentication failed. Please try again.',
    code: err.code,
    status: err.status,
  };
}

/**
 * Detects whether an authentication error is due to a network connection or offline state.
 */
export function isNetworkOrOfflineError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    const msg = error.toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('connection refused')
    );
  }
  if (typeof error === 'object' && error !== null) {
    const err = error as { message?: string; name?: string; status?: number; code?: string };
    if (err.name === 'AuthRetryableFetchError' || err.code === 'offline') {
      return true;
    }
    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('network request failed') ||
      msg.includes('connection refused')
    ) {
      return true;
    }
    if (err.status === 0 || (typeof err.status === 'number' && err.status >= 500 && err.status < 600)) {
      return true;
    }
  }
  return false;
}

/**
 * Maps authentication errors to safe, user-friendly messages conforming to security rules:
 * - Failed sign-in: ONE generic message ("Wrong email or password. Please try again.")
 * - Create account: Real, safe messages (weak password, already registered, etc.)
 * - Forgot password: Safe messages for reset requests
 */
export function getSafeAuthErrorMessage(
  mode: 'sign-in' | 'sign-up' | 'forgot-password',
  error: unknown
): string {
  if (!error) {
    return 'An unexpected error occurred. Please try again.';
  }

  if (isNetworkOrOfflineError(error)) {
    return 'Unable to connect to the authentication server. Please check your internet connection.';
  }

  // Exact rule for failed sign-in: ONE generic message, never saying which part was wrong!
  if (mode === 'sign-in') {
    return 'Wrong email or password. Please try again.';
  }

  let raw = '';
  if (typeof error === 'string') {
    raw = error.toLowerCase();
  } else if (typeof error === 'object' && error !== null) {
    const err = error as { message?: string; code?: string };
    raw = `${err.message || ''} ${err.code || ''}`.toLowerCase();
  }

  if (mode === 'sign-up') {
    if (
      raw.includes('password') &&
      (raw.includes('least') || raw.includes('short') || raw.includes('weak') || raw.includes('characters'))
    ) {
      return 'Password must be at least 6 characters.';
    }
    if (
      raw.includes('already registered') ||
      raw.includes('already exists') ||
      raw.includes('user_already_exists')
    ) {
      return 'An account with this email already exists.';
    }
    if (raw.includes('valid email') || raw.includes('invalid email') || raw.includes('email address')) {
      return 'Please enter a valid email address.';
    }
    return 'Unable to create account. Please check your details and try again.';
  }

  if (mode === 'forgot-password') {
    if (raw.includes('valid email') || raw.includes('invalid email') || raw.includes('email address')) {
      return 'Please enter a valid email address.';
    }
    return 'Unable to send reset instructions. Please try again.';
  }

  return 'An error occurred. Please try again.';
}

/**
 * Sign in with email and password.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResult<SignInSuccessData>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        message: 'Supabase credentials are not configured in your .env file.',
      },
    };
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return { data: null, error: { message: emailError } };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { data: null, error: { message: passwordError } };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { data: null, error: formatAuthError(error) };
    }

    if (!data.user || !data.session) {
      return {
        data: null,
        error: { message: 'Authentication completed but no active session was returned.' },
      };
    }

    return {
      data: {
        user: data.user,
        session: data.session,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: formatAuthError(err) };
  }
}

/**
 * Sign up a new user with email and password.
 */
export async function signUpWithEmail(
  email: string,
  password: string
): Promise<AuthResult<SignUpSuccessData>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        message: 'Supabase credentials are not configured in your .env file.',
      },
    };
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return { data: null, error: { message: emailError } };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { data: null, error: { message: passwordError } };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      return { data: null, error: formatAuthError(error) };
    }

    // When email confirmation is enabled on Supabase, session is null until verified.
    const requiresEmailConfirmation = !data.session;

    return {
      data: {
        user: data.user,
        session: data.session,
        requiresEmailConfirmation,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: formatAuthError(err) };
  }
}

/**
 * Sign out the currently authenticated user.
 * Tries global sign out first; falls back to local sign out if offline.
 */
export async function signOut(): Promise<AuthResult<null>> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Fallback to local scope so session is always cleared locally on device
      await supabase.auth.signOut({ scope: 'local' });
    }
    return { data: null, error: null };
  } catch {
    try {
      await supabase.auth.signOut({ scope: 'local' });
      return { data: null, error: null };
    } catch (fallbackErr) {
      return { data: null, error: formatAuthError(fallbackErr) };
    }
  }
}

/**
 * Send password reset instructions to the given email.
 */
export async function sendPasswordResetEmail(
  email: string,
  redirectTo?: string
): Promise<AuthResult<null>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        message: 'Supabase credentials are not configured in your .env file.',
      },
    };
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return { data: null, error: { message: emailError } };
  }

  try {
    const options = redirectTo ? { redirectTo } : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), options);
    if (error) {
      return { data: null, error: formatAuthError(error) };
    }
    return { data: null, error: null };
  } catch (err) {
    return { data: null, error: formatAuthError(err) };
  }
}

/**
 * Retrieves the current session from secure storage.
 */
export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

/**
 * Retrieves the currently authenticated user.
 */
export async function getUser(): Promise<User | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}
